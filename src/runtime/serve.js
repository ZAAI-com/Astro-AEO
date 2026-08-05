// @ts-check
import { buildPage, basePrefix, pagePathForMdPath } from '../core/page-model.js';
import { createTurndown } from '../core/html-to-md.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { renderLlmsTxt, renderLlmsFullTxt } from '../core/render/llms-txt.js';
import { buildRobotsTxt } from '../core/render/robots-txt.js';
import { buildDomainProfile } from '../core/render/domain-profile.js';
import { resolveSiteMeta } from '../core/site-meta.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';
import { normalizeCatalogPathname } from '../core/match.js';

/**
 * @typedef {object} Runtime
 * @property {'dev'|'build'|'preview'} command
 * @property {import('../index.js').ResolvedAstroAeoConfig} config
 * @property {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @property {string[]} staticPaths
 * @property {string[]} [projectPaths]
 * @property {RegExp[]} [projectPatterns]
 * @property {string} internalRequestToken
 * @property {Record<string, { markdown: string; path: string }>} standaloneSources
 */

/** @typedef {{ html: string | null; response: Response }} HtmlLoad */
/** @typedef {(pathname: string) => Promise<HtmlLoad | null>} HtmlFetcher */
/** @typedef {{ body: string | null; source: Response | null }} MarkdownResult */

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
/** @type {WeakMap<Runtime, { catalogs: import('../page.js').PageCatalog[]; pages: Promise<import('../page.js').PageDescriptor[]> }>} */
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
 * @param {{ sitemapAvailable?: boolean }} [opts]
 * @returns {{ body: string; contentType: string }}
 */
export function renderStandaloneArtifact(kind, runtime, opts = {}) {
  const { config, site } = runtime;
  if (kind === 'robots') {
    const policy = config.discovery.robots.sitemapPolicy;
    const available = opts.sitemapAvailable ?? policy === 'always';
    return {
      body: buildRobotsTxt(config, site.siteUrl, site.base, available),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  return {
    body: `${JSON.stringify(buildDomainProfile(config, site.siteUrl), null, 2)}\n`,
    contentType: 'application/json; charset=utf-8',
  };
}

/**
 * @param {string} pathname
 * @param {string} html
 * @param {Runtime} runtime
 * @param {import('../page.js').PageDescriptor} [descriptor]
 * @param {boolean} [allowAuthored]
 * @returns {Promise<import('../core/page-model.js').AeoPage | null>}
 */
export async function pageFromHtml(pathname, html, runtime, descriptor, allowAuthored = true) {
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
    site: runtime.site,
    getTurndown: () => runtimeTurndownFor(runtime),
    authored,
    allowMarker: allowAuthored,
  });
  return 'skip' in result ? null : result.page;
}

/**
 * @param {string} mdPathname
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ catalogs?: import('../page.js').PageCatalog[] }} [opts]
 * @returns {Promise<MarkdownResult>}
 */
export async function serveMarkdown(mdPathname, runtime, fetchHtml, opts = {}) {
  const pagePath = pagePathForMdPath(mdPathname);
  if (pagePath === null) return { body: null, source: null };

  const descriptors = await runtimeCatalogPagesFor(opts.catalogs ?? [], runtime);
  const descriptor = descriptors.find((candidate) => candidate.pathname === pagePath);
  const loaded = await fetchHtml(pagePath);
  if (loaded === null || loaded.html === null) {
    return { body: null, source: loaded?.response ?? null };
  }
  if (loaded.response.status >= 300 && loaded.response.status < 400) {
    return { body: null, source: loaded.response };
  }

  const page = await pageFromHtml(
    pagePath,
    loaded.html,
    runtime,
    descriptor,
    loaded.response.ok,
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
 * @param {{ note?: string; concurrency?: number; catalogs?: import('../page.js').PageCatalog[] }} [opts]
 * @returns {Promise<string>}
 */
export async function serveLlmsIndex(kind, runtime, fetchHtml, opts = {}) {
  const descriptors = await runtimeCatalogPagesFor(opts.catalogs ?? [], runtime);
  const descriptorByPath = new Map(descriptors.map((descriptor) => [descriptor.pathname, descriptor]));
  const paths = [
    ...new Set(
      [...runtime.staticPaths, ...descriptorByPath.keys()]
        .map((pathname) => normalizeRuntimePath(pathname))
        .filter((pathname) => !isOwnedArtifactPath(pathname, runtime.config)),
    ),
  ];
  const maxPages = runtime.config.corpus.runtime.maxPages;
  if (maxPages !== 'unlimited' && paths.length > maxPages) {
    throw new RuntimeCorpusLimitError(paths.length, maxPages);
  }

  const pages = await collectConcurrently(
    paths,
    Math.min(Math.max(opts.concurrency ?? 4, 1), 4),
    async (pathname) => {
      const descriptor = descriptorByPath.get(pathname);
      const loaded = await fetchHtml(pathname);
      if (loaded === null || loaded.html === null || !loaded.response.ok) return null;
      return await pageFromHtml(pathname, loaded.html, runtime, descriptor);
    },
  );

  const home = pages.find((p) => p.pathname === '/');
  const siteMeta = resolveSiteMeta(runtime.config, runtime.site.siteUrl, home?.title ?? '');
  const render = kind === 'llms-full' ? renderLlmsFullTxt : renderLlmsTxt;
  return render(pages, runtime.config, siteMeta, { note: opts.note });
}

/** @param {import('../page.js').PageCatalog[]} catalogs @param {Runtime} runtime */
function runtimeCatalogPagesFor(catalogs, runtime) {
  const cached = runtimeCatalogPages.get(runtime);
  if (cached && cached.catalogs === catalogs) return cached.pages;
  const pages = loadRuntimeCatalogPages(catalogs, runtime);
  runtimeCatalogPages.set(runtime, { catalogs, pages });
  return pages;
}

/**
 * @param {import('../page.js').PageCatalog[]} catalogs
 * @param {Runtime} runtime
 * @returns {Promise<import('../page.js').PageDescriptor[]>}
 */
async function loadRuntimeCatalogPages(catalogs, runtime) {
  /** @type {import('../page.js').PageDescriptor[]} */
  const descriptors = [];
  const seen = new Set();
  const context = {
    command: runtime.command,
    siteUrl: runtime.site.siteUrl,
    base: runtime.site.base,
    trailingSlash: runtime.site.trailingSlash,
  };
  for (const catalog of catalogs) {
    try {
      if (typeof catalog?.listPages !== 'function') throw new Error('no listPages() export');
      const listed = await catalog.listPages(context);
      for (const value of Array.isArray(listed) ? listed : []) {
        const pathname = normalizeCatalogPathname(value?.pathname);
        if (pathname === null) {
          console.warn('astro-aeo: a runtime page catalog returned an unsafe or non-root-relative pathname; it was ignored.');
          continue;
        }
        if (seen.has(pathname)) {
          console.warn(`astro-aeo: more than one runtime catalog described ${pathname}; the first descriptor wins.`);
          continue;
        }
        seen.add(pathname);
        descriptors.push({ ...value, pathname });
      }
    } catch (error) {
      console.warn(
        `astro-aeo: a runtime page catalog failed and contributed nothing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return descriptors;
}

/** @param {string} pathname @returns {string} */
function normalizeRuntimePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return `/${pathname.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * @template T
 * @param {string[]} items
 * @param {number} limit
 * @param {(item: string) => Promise<T | null>} run
 * @returns {Promise<T[]>}
 */
export async function collectConcurrently(items, limit, run) {
  /** @type {(T | null)[]} */
  const results = new Array(items.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return /** @type {T[]} */ (results.filter((r) => r !== null));
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
