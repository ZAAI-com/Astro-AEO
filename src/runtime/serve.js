// @ts-check
import { buildPage, basePrefix, pagePathForMdPath } from '../core/page-model.js';
import { createTurndown } from '../core/html-to-md.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { renderLlmsTxt, renderLlmsFullTxt } from '../core/render/llms-txt.js';
import { buildRobotsTxt } from '../core/render/robots-txt.js';
import { buildDomainProfile } from '../core/render/domain-profile.js';
import { resolveSiteMeta } from '../core/site-meta.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';
import { inspectRootPathname, normalizeCatalogPathname } from '../core/match.js';
import { cancelResponseBody, isIdentityEncoded, isNullBodyStatus } from './respond.js';

/**
 * @typedef {object} Runtime
 * @property {'dev'|'build'|'preview'} command
 * @property {import('../index.js').ResolvedAstroAeoConfig} config
 * @property {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @property {boolean} [sitemapAvailable]
 * @property {string[]} staticPaths
 * @property {string[]} [projectPaths]
 * @property {RegExp[]} [projectPatterns]
 * @property {Record<string, { markdown: string; path: string }>} standaloneSources
 */

/** @typedef {{ html: string | null; response: Response }} HtmlLoad */
/** @typedef {(pathname: string) => Promise<HtmlLoad | null>} HtmlFetcher */
/** @typedef {{ body: string | null; source: Response | null }} MarkdownResult */
/** @typedef {{ module: string; load: () => Promise<import('../page.js').PageCatalog> }} RuntimeCatalogLoader */

export class RuntimeCorpusLimitError extends Error {
  /** @param {number} pages @param {number} limit */
  constructor(pages, limit) {
    super(
      `astro-aeo: request-time corpus contains ${pages} pages, exceeding corpus.runtime.maxPages (${limit}).`,
    );
    this.name = 'RuntimeCorpusLimitError';
    this.pages = pages;
    this.limit = limit;
  }
}

/** @type {WeakMap<Runtime, Promise<import('turndown')>>} */
const runtimeTurndown = new WeakMap();
/** @type {WeakMap<Runtime, { loaders: RuntimeCatalogLoader[]; siteUrl: string; pages: Promise<import('../page.js').PageDescriptor[]> }>} */
const runtimeCatalogPages = new WeakMap();

/**
 * @param {string} pathname
 * @param {string} base
 * @returns {string}
 */
export function stripBase(pathname, base) {
  const prefix = basePrefix(base);
  if (!prefix || !pathname.startsWith(prefix)) return pathname;
  return pathname.slice(prefix.length) || '/';
}

/**
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {'robots'|'domain-profile'|'llms'|'llms-full'|null}
 */
export function artifactFor(pathname, config) {
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return 'robots';
  if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) {
    return 'domain-profile';
  }
  if (pathname === '/llms.txt' && config.corpus.index.enabled) return 'llms';
  if (pathname === '/llms-full.txt' && config.corpus.full.enabled) return 'llms-full';
  return null;
}

/**
 * @param {'robots'|'domain-profile'} kind
 * @param {Runtime} runtime
 * @param {{ sitemapAvailable?: boolean; origin?: string }} [opts]
 * @returns {{ body: string; contentType: string }}
 */
export function renderStandaloneArtifact(kind, runtime, opts = {}) {
  const { config, site } = runtime;
  const siteUrl = effectiveSiteUrl(runtime, opts.origin);
  if (kind === 'robots') {
    const policy = config.discovery.robots.sitemapPolicy;
    const available = opts.sitemapAvailable ?? policy === 'always';
    return {
      body: buildRobotsTxt(config, siteUrl, site.base, available),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  return {
    body: `${JSON.stringify(buildDomainProfile(config, siteUrl), null, 2)}\n`,
    contentType: 'application/json; charset=utf-8',
  };
}

/**
 * @param {string} pathname
 * @param {string} html
 * @param {Runtime} runtime
 * @param {{ descriptor?: import('../page.js').PageDescriptor; allowAuthored?: boolean; origin?: string; publicPathname?: string }} [opts]
 * @returns {Promise<import('../core/page-model.js').AeoPage | null>}
 */
export async function pageFromHtml(pathname, html, runtime, opts = {}) {
  const { descriptor: configuredDescriptor, origin } = opts;
  const allowAuthored = opts.allowAuthored ?? true;
  let descriptor = configuredDescriptor;
  const standalone = allowAuthored ? runtime.standaloneSources?.[pathname] : undefined;
  if (!allowAuthored) descriptor = undefined;
  const descriptorMarkdown =
    typeof descriptor?.markdown === 'string'
      ? descriptor.markdown
      : typeof descriptor?.source?.body === 'string'
        ? descriptor.source.body
        : undefined;
  const authored = descriptor || standalone
    ? {
        ...(descriptorMarkdown !== undefined
          ? { markdown: descriptorMarkdown, strategy: /** @type {const} */ ('catalog') }
          : standalone
            ? { markdown: standalone.markdown, strategy: /** @type {const} */ ('markdown-route') }
            : {}),
        ...(descriptor?.title !== undefined ? { title: descriptor.title } : {}),
        ...(descriptor?.description !== undefined ? { description: descriptor.description } : {}),
        ...(descriptor?.lastModified !== undefined ? { lastModified: descriptor.lastModified } : {}),
        ...(descriptor?.extraction ? { extraction: descriptor.extraction } : {}),
        ...(descriptor?.sourcePath || descriptor?.source?.path || standalone?.path
          ? { path: descriptor?.sourcePath ?? descriptor?.source?.path ?? standalone?.path }
          : {}),
      }
    : undefined;
  const result = await buildPage({
    pathname,
    html,
    config: runtime.config,
    site: siteForRequest(runtime, origin),
    getTurndown: () => runtimeTurndownFor(runtime),
    authored,
    allowMarker: allowAuthored,
    publicPathname: opts.publicPathname,
  });
  return 'skip' in result ? null : result.page;
}

/**
 * @param {string} mdPathname
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ catalogLoaders?: RuntimeCatalogLoader[]; origin?: string; publicPathname?: string }} [opts]
 * @returns {Promise<MarkdownResult>}
 */
export async function serveMarkdown(mdPathname, runtime, fetchHtml, opts = {}) {
  const requestedPagePath = pagePathForMdPath(mdPathname);
  if (requestedPagePath === null) return { body: null, source: null };
  const pagePath = canonicalRuntimePath(requestedPagePath).canonical;

  const descriptors = await runtimeCatalogPagesFor(
    opts.catalogLoaders ?? [],
    runtime,
    opts.origin,
  );
  const descriptor = descriptors.find(
    (candidate) => catalogRuntimePath(candidate.pathname).canonical === pagePath,
  );
  const publicPathname = opts.publicPathname ??
    (descriptor
      ? catalogRuntimePath(descriptor.pathname).publicPathname
      : canonicalRuntimePath(requestedPagePath).publicPathname);
  const loaded = await fetchHtml(publicPathname);
  if (loaded === null || loaded.html === null) {
    return { body: null, source: loaded?.response ?? null };
  }
  if (isNullBodyStatus(loaded.response.status)) {
    return { body: null, source: loaded.response };
  }
  if (loaded.response.status === 206 || !isIdentityEncoded(loaded.response)) {
    return { body: null, source: loaded.response };
  }
  if (loaded.response.status >= 300 && loaded.response.status < 400) {
    return { body: null, source: loaded.response };
  }

  const page = await pageFromHtml(
    pagePath,
    loaded.html,
    runtime,
    {
      descriptor,
      allowAuthored: loaded.response.ok,
      origin: opts.origin,
      publicPathname,
    },
  );
  if (!page || page.aeoTokens.includes('no-dotmd')) {
    return { body: null, source: loaded.response };
  }
  return { body: renderMarkdownDocument(page, runtime.config), source: loaded.response };
}

/**
 * @param {'llms'|'llms-full'} kind
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ note?: string; concurrency?: number; catalogLoaders?: RuntimeCatalogLoader[]; origin?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function serveLlmsIndex(kind, runtime, fetchHtml, opts = {}) {
  const descriptors = await runtimeCatalogPagesFor(
    opts.catalogLoaders ?? [],
    runtime,
    opts.origin,
  );
  /** @type {Map<string, { pathname: string; publicPathname: string; descriptor?: import('../page.js').PageDescriptor }>} */
  const pagesByPath = new Map();
  for (const value of runtime.staticPaths) {
    const path = canonicalRuntimePath(value);
    if (isOwnedArtifactPath(path.canonical, runtime.config)) continue;
    if (!pagesByPath.has(path.canonical)) {
      pagesByPath.set(path.canonical, {
        pathname: path.canonical,
        publicPathname: path.publicPathname,
      });
    }
  }
  for (const descriptor of descriptors) {
    const path = catalogRuntimePath(descriptor.pathname);
    if (isOwnedArtifactPath(path.canonical, runtime.config)) continue;
    const current = pagesByPath.get(path.canonical);
    pagesByPath.set(path.canonical, {
      pathname: current?.pathname ?? path.canonical,
      publicPathname: path.publicPathname,
      descriptor,
    });
  }
  const paths = [...pagesByPath.values()];
  const maxPages = runtime.config.corpus.runtime.maxPages;
  if (maxPages !== 'unlimited' && paths.length > maxPages) {
    throw new RuntimeCorpusLimitError(paths.length, maxPages);
  }

  const pages = await collectConcurrently(
    paths,
    Math.min(Math.max(opts.concurrency ?? 1, 1), 4),
    async (pathname) => {
      const loaded = await fetchHtml(pathname.publicPathname);
      if (
        loaded === null ||
        loaded.html === null ||
        !loaded.response.ok ||
        loaded.response.status === 206 ||
        !isIdentityEncoded(loaded.response)
      ) {
        cancelResponseBody(loaded?.response);
        return null;
      }
      return await pageFromHtml(pathname.pathname, loaded.html, runtime, {
        descriptor: pathname.descriptor,
        origin: opts.origin,
        publicPathname: pathname.publicPathname,
      });
    },
  );

  const home = pages.find((p) => p.pathname === '/');
  const siteMeta = resolveSiteMeta(
    runtime.config,
    effectiveSiteUrl(runtime, opts.origin),
    home?.title ?? '',
  );
  const render = kind === 'llms-full' ? renderLlmsFullTxt : renderLlmsTxt;
  return render(pages, runtime.config, siteMeta, { note: opts.note });
}

/**
 * @param {RuntimeCatalogLoader[]} loaders
 * @param {Runtime} runtime
 * @param {string} [origin]
 */
function runtimeCatalogPagesFor(loaders, runtime, origin) {
  const siteUrl = effectiveSiteUrl(runtime, origin);
  const cached = runtimeCatalogPages.get(runtime);
  if (cached && cached.loaders === loaders && cached.siteUrl === siteUrl) {
    return cached.pages;
  }
  const pages = loadRuntimeCatalogPages(loaders, runtime, siteUrl);
  runtimeCatalogPages.set(runtime, {
    loaders,
    siteUrl,
    pages,
  });
  return pages;
}

/**
 * @param {RuntimeCatalogLoader[]} loaders
 * @param {Runtime} runtime
 * @param {string} siteUrl
 * @returns {Promise<import('../page.js').PageDescriptor[]>}
 */
async function loadRuntimeCatalogPages(loaders, runtime, siteUrl) {
  /** @type {import('../page.js').PageDescriptor[]} */
  const descriptors = [];
  const seen = new Set();
  const context = {
    command: runtime.command,
    siteUrl,
    base: runtime.site.base,
    trailingSlash: runtime.site.trailingSlash,
  };
  for (const loader of loaders) {
    try {
      const catalog = await loader.load();
      if (typeof catalog?.listPages !== 'function') throw new Error('no listPages() export');
      const listed = await catalog.listPages(context);
      for (const value of Array.isArray(listed) ? listed : []) {
        const pathname = normalizeCatalogPathname(value?.pathname);
        if (pathname === null) {
          console.warn('astro-aeo: a runtime page catalog returned an unsafe or non-root-relative pathname; it was ignored.');
          continue;
        }
        const canonicalPathname = catalogRuntimePath(pathname).canonical;
        if (seen.has(canonicalPathname)) {
          console.warn(`astro-aeo: more than one runtime catalog described ${pathname}; the first descriptor wins.`);
          continue;
        }
        seen.add(canonicalPathname);
        descriptors.push({ ...value, pathname });
      }
    } catch (error) {
      console.warn(
        `astro-aeo: the runtime page catalog "${loader.module}" failed and contributed nothing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return descriptors;
}

/** @param {Runtime} runtime @param {string} [origin] @returns {string} */
function effectiveSiteUrl(runtime, origin) {
  return runtime.site.siteUrl || origin || '';
}

/**
 * Preserve the stable runtime object used by caches while supplying a request
 * origin to the source-agnostic page builder when Astro has no configured site.
 * @param {Runtime} runtime
 * @param {string} [origin]
 * @returns {Runtime['site']}
 */
function siteForRequest(runtime, origin) {
  const siteUrl = effectiveSiteUrl(runtime, origin);
  return siteUrl === runtime.site.siteUrl ? runtime.site : { ...runtime.site, siteUrl };
}

/** @param {string} pathname @returns {string} */
function normalizeRuntimePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return `/${pathname.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Keep an already-decoded request or Astro route key for matching while
 * retaining a valid URL spelling for rewrites and emitted links.
 * @param {string} pathname
 * @returns {{ canonical: string; publicPathname: string }}
 */
function canonicalRuntimePath(pathname) {
  const normalized = normalizeRuntimePath(pathname);
  return { canonical: normalized, publicPathname: encodeURI(normalized) };
}

/**
 * Catalog pathnames use URL spelling, unlike already-decoded request and Astro
 * route keys. Decode them exactly once before matching those canonical keys.
 * @param {string} pathname
 * @returns {{ canonical: string; publicPathname: string }}
 */
function catalogRuntimePath(pathname) {
  const normalized = normalizeRuntimePath(pathname);
  const inspected = inspectRootPathname(normalized);
  const canonical = inspected
    ? normalizeRuntimePath(inspected.decoded)
    : normalized;
  return { canonical, publicPathname: encodeURI(canonical) };
}

/**
 * @template TItem, TResult
 * @param {TItem[]} items
 * @param {number} limit
 * @param {(item: TItem) => Promise<TResult | null>} run
 * @returns {Promise<TResult[]>}
 */
export async function collectConcurrently(items, limit, run) {
  /** @type {(TResult | null)[]} */
  const results = new Array(items.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return /** @type {TResult[]} */ (results.filter((r) => r !== null));
}

/**
 * @param {Runtime} runtime
 * @returns {Promise<import('turndown')>}
 */
function runtimeTurndownFor(runtime) {
  let td = runtimeTurndown.get(runtime);
  if (!td) {
    td = createTurndown();
    runtimeTurndown.set(runtime, td);
  }
  return td;
}
