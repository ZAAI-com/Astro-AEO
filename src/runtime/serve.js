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
import { enrichHtmlHead, stripAeoHeadMarkers } from '../core/head.js';
import { renderSchemaCorpus } from '../core/schema-corpus.js';
import { stableCanonical } from '../core/canonical.js';
import { catalogBreadcrumbTrail } from '../core/catalog-breadcrumbs.js';
import { loadRuntimeMarkdownRenderers } from './markdown-renderers.js';
import { loadRuntimePlugins } from './plugins.js';

/**
 * @typedef {object} Runtime
 * @property {'dev'|'build'|'preview'} command
 * @property {import('../index.js').ResolvedAstroAeoConfig} config
 * @property {{ siteUrl: string; stableSiteUrl?: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @property {boolean} [sitemapAvailable]
 * @property {string[]} staticPaths
 * @property {string[]} [projectPaths]
 * @property {RegExp[]} [projectPatterns]
 * @property {Record<string, { kind?: 'markdown'|'mdx'; body?: string; markdown?: string; path: string }>} standaloneSources
 */

/** @typedef {{ html: string | null; response: Response }} HtmlLoad */
/** @typedef {(pathname: string) => Promise<HtmlLoad | null>} HtmlFetcher */
/** @typedef {{ body: string | null; source: Response | null }} MarkdownResult */
/** @typedef {{ module: string; load: () => Promise<import('../page.js').PageCatalog> }} RuntimeCatalogLoader */
/** @typedef {import('./markdown-renderers.js').RuntimeMarkdownRendererLoader} RuntimeMarkdownRendererLoader */
/** @typedef {import('./plugins.js').RuntimePluginLoader} RuntimePluginLoader */

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
 * @returns {'robots'|'domain-profile'|'llms'|'llms-full'|'schema-graph'|'schema-map'|null}
 */
export function artifactFor(pathname, config) {
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return 'robots';
  if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) {
    return 'domain-profile';
  }
  if (pathname === '/llms.txt' && config.corpus.index.enabled) return 'llms';
  if (pathname === '/llms-full.txt' && config.corpus.full.enabled) return 'llms-full';
  if (config.schema.corpus.enabled && pathname === config.schema.corpus.graphPath) return 'schema-graph';
  if (config.schema.corpus.enabled && pathname === config.schema.corpus.mapPath) return 'schema-map';
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
 * @param {{ descriptor?: import('../page.js').PageDescriptor; allowAuthored?: boolean; origin?: string; publicPathname?: string; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[] }} [opts]
 * @returns {Promise<import('../core/page-model.js').AeoPage | null>}
 */
export async function pageFromHtml(pathname, html, runtime, opts = {}) {
  const { descriptor: configuredDescriptor, origin } = opts;
  const allowAuthored = opts.allowAuthored ?? true;
  const pluginLoaders = opts.pluginLoaders ?? [];
  const plugins = pluginLoaders.length > 0
    ? await loadRuntimePlugins(pluginLoaders, runtime.command)
    : null;
  /** @type {import('../page.js').PageDescriptor | undefined} */
  let descriptor = allowAuthored ? configuredDescriptor : undefined;
  /** @type {import('../index.js').Diagnostic[]} */
  const lifecycleDiagnostics = [];
  if (plugins) {
    const initialDescriptor = descriptor ?? { pathname };
    const discovered = await plugins.run('page:discovered', initialDescriptor, {
      pathname,
      validate: (value) => isPageDescriptor(value) && value.pathname === pathname,
    });
    lifecycleDiagnostics.push(...discovered.diagnostics);
    if (discovered.isolated) return null;
    const candidate = /** @type {import('../page.js').PageDescriptor} */ (/** @type {unknown} */ (discovered.value));
    descriptor = configuredDescriptor !== undefined || !isMinimalPageDescriptor(candidate, pathname)
      ? candidate
      : undefined;
  }
  const standalone = allowAuthored ? runtime.standaloneSources?.[pathname] : undefined;
  const configuredMarkdown =
    typeof descriptor?.markdown === 'string'
      ? descriptor.markdown
      : descriptor?.source?.kind === 'markdown' && typeof descriptor.source.body === 'string'
        ? descriptor.source.body
        : undefined;
  const descriptorMarkdown = configuredMarkdown ??
    (typeof standalone?.markdown === 'string' ? standalone.markdown : undefined);
  const sourceBody =
    descriptorMarkdown === undefined && typeof descriptor?.source?.body === 'string'
      ? descriptor.source.body
      : descriptorMarkdown === undefined && standalone?.kind === 'mdx' && typeof standalone.body === 'string'
        ? standalone.body
        : undefined;
  /** @type {'catalog' | 'markdown-route'} */
  const exactStrategy = configuredMarkdown !== undefined ? 'catalog' : 'markdown-route';
  /** @type {'catalog' | 'markdown-route'} */
  const authoredStrategy = descriptor ? 'catalog' : 'markdown-route';
  const authored = descriptor || standalone
    ? {
        ...(descriptorMarkdown !== undefined
          ? {
              markdown: descriptorMarkdown,
              strategy: exactStrategy,
            }
          : sourceBody !== undefined
            ? { body: sourceBody, strategy: authoredStrategy }
            : {}),
        ...(descriptor?.title !== undefined ? { title: descriptor.title } : {}),
        ...(descriptor?.description !== undefined ? { description: descriptor.description } : {}),
        ...(descriptor?.image !== undefined ? { image: descriptor.image } : {}),
        ...(descriptor?.language !== undefined ? { language: descriptor.language } : {}),
        ...(descriptor?.dates?.published !== undefined ? { published: descriptor.dates.published } : {}),
        ...(descriptor?.dates?.modified !== undefined || descriptor?.lastModified !== undefined
          ? { lastModified: descriptor?.dates?.modified ?? descriptor?.lastModified }
          : {}),
        ...(descriptor?.authors ? { authors: descriptor.authors } : {}),
        ...(descriptor?.entities ? { entities: descriptor.entities } : {}),
        ...(descriptor?.directives ? { directives: descriptor.directives } : {}),
        ...(descriptor?.source?.kind
          ? { kind: descriptor.source.kind }
          : standalone?.kind
            ? { kind: standalone.kind }
            : {}),
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
    renderers: await loadRuntimeMarkdownRenderers(opts.rendererLoaders ?? []),
    allowMarker: allowAuthored,
    publicPathname: opts.publicPathname,
    routePattern: descriptor?.routePattern,
  });
  if ('skip' in result) return null;
  let page = result.page;
  if (!plugins) return page;

  const extracted = await plugins.run('page:extract', {
    representations: page.representations,
    extraction: page.extraction ?? null,
    source: page.source,
  }, {
    pathname,
    validate: isExtractionEnvelope,
  });
  lifecycleDiagnostics.push(...extracted.diagnostics);
  if (extracted.isolated) return null;
  const extraction = /** @type {any} */ (extracted.value);
  page = {
    ...page,
    representations: extraction.representations,
    ...('extraction' in extraction ? { extraction: extraction.extraction ?? undefined } : {}),
    ...('source' in extraction ? { source: extraction.source ?? undefined } : {}),
    markdown: extraction.representations.markdown ?? '',
  };

  const transformed = await plugins.run('page:transform', page, {
    pathname,
    validate: (value) => isPageRecord(value) && value.id === page.id && value.pathname === page.pathname,
  });
  lifecycleDiagnostics.push(...transformed.diagnostics);
  if (transformed.isolated) return null;
  const replacement = /** @type {import('../core/page-model.js').AeoPage} */ (/** @type {unknown} */ (transformed.value));
  page = {
    ...page,
    ...replacement,
    title: replacement.metadata.title,
    description: replacement.metadata.description ?? '',
    markdown: replacement.representations.markdown ?? '',
    diagnostics: [...page.diagnostics, ...lifecycleDiagnostics],
  };

  const metadata = await plugins.run('page:metadata', page.metadata, {
    pathname,
    validate: isPageMetadata,
  });
  if (metadata.isolated) return null;
  page = {
    ...page,
    metadata: /** @type {import('../core/page-model.js').AeoPage['metadata']} */ (metadata.value),
    title: /** @type {import('../core/page-model.js').AeoPage['metadata']} */ (metadata.value).title,
    description: /** @type {import('../core/page-model.js').AeoPage['metadata']} */ (metadata.value).description ?? '',
    diagnostics: [...page.diagnostics, ...metadata.diagnostics],
  };
  return page;
}

/**
 * Run the internal semantic transform first, then the public runtime graph
 * hooks from their build-validated manifest. A nonrecoverable user hook
 * isolates semantic output while leaving the application HTML available.
 *
 * @param {string} html
 * @param {import('../core/page-model.js').AeoPage} page
 * @param {Runtime} runtime
 * @param {{ pluginLoaders?: RuntimePluginLoader[]; catalogLoaders?: RuntimeCatalogLoader[]; catalogDescriptors?: readonly import('../page.js').PageDescriptor[]; origin?: string; allowGlobal?: boolean }} [opts]
 */
export async function enrichRuntimePageGraph(html, page, runtime, opts = {}) {
  const catalogDescriptors = opts.catalogDescriptors ?? await runtimeCatalogPagesFor(
    opts.catalogLoaders ?? [],
    runtime,
    opts.origin,
  );
  const internal = enrichHtmlHead({
    html,
    page,
    config: runtime.config,
    site: runtime.site,
    allowGlobal: opts.allowGlobal ?? true,
    breadcrumbTrail: catalogBreadcrumbTrail(page.pathname, catalogDescriptors, runtime.site),
  });
  const loaders = opts.pluginLoaders ?? [];
  if (loaders.length === 0) return { ...internal, isolated: false };

  const plugins = await loadRuntimePlugins(loaders, runtime.command);
  const initial = {
    html: internal.html,
    page: internal.page,
    site: runtime.site,
    graph: internal.graph,
    normalizedGraph: internal.normalizedGraph,
    explicit: internal.explicit,
  };
  const semantic = await plugins.run('graph:build', initial, {
    pathname: page.pathname,
    validate: isGraphEnvelope,
  });
  if (semantic.isolated) {
    return {
      html: stripAeoHeadMarkers(html),
      page: internal.page,
      graph: null,
      normalizedGraph: undefined,
      explicit: internal.explicit,
      canonicalUrl: internal.canonicalUrl,
      diagnostics: [...internal.diagnostics, ...semantic.diagnostics],
      isolated: true,
    };
  }
  const value = /** @type {any} */ (semantic.value);
  return {
    html: value.html,
    page: value.page,
    graph: value.graph,
    normalizedGraph: value.normalizedGraph,
    explicit: value.explicit,
    canonicalUrl: typeof value.page?.canonicalUrl === 'string'
      ? value.page.canonicalUrl
      : internal.canonicalUrl,
    diagnostics: [...internal.diagnostics, ...semantic.diagnostics],
    isolated: false,
  };
}

/**
 * @param {string} mdPathname
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; origin?: string; publicPathname?: string }} [opts]
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
      rendererLoaders: opts.rendererLoaders,
      pluginLoaders: opts.pluginLoaders,
    },
  );
  if (!page || page.aeoTokens.includes('no-dotmd') || page.directives.generateMarkdown === false) {
    return { body: null, source: loaded.response };
  }
  return { body: renderMarkdownDocument(page, runtime.config), source: loaded.response };
}

/**
 * @param {'llms'|'llms-full'} kind
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ note?: string; concurrency?: number; catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; origin?: string }} [opts]
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
        rendererLoaders: opts.rendererLoaders,
        pluginLoaders: opts.pluginLoaders,
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
 * Render one member of the opt-in semantic corpus pair using the same anonymous,
 * serial page rewrites as llms-full.txt.
 *
 * @param {'schema-graph'|'schema-map'} kind
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; origin?: string }} [opts]
 * @returns {Promise<{ body: string; contentType: string }>}
 */
export async function serveSchemaCorpus(kind, runtime, fetchHtml, opts = {}) {
  const siteUrl = stableCanonical(runtime.site.siteUrl);
  if (!siteUrl) throw new RuntimeSchemaCorpusError('A stable configured Astro site is required.');
  const descriptors = await runtimeCatalogPagesFor(opts.catalogLoaders ?? [], runtime, opts.origin);
  /** @type {Map<string, { pathname: string; publicPathname: string; descriptor?: import('../page.js').PageDescriptor }>} */
  const pagesByPath = new Map();
  for (const value of runtime.staticPaths) {
    const path = canonicalRuntimePath(value);
    if (!isOwnedArtifactPath(path.canonical, runtime.config)) {
      pagesByPath.set(path.canonical, { pathname: path.canonical, publicPathname: path.publicPathname });
    }
  }
  for (const descriptor of descriptors) {
    const path = catalogRuntimePath(descriptor.pathname);
    if (isOwnedArtifactPath(path.canonical, runtime.config)) continue;
    pagesByPath.set(path.canonical, {
      pathname: path.canonical,
      publicPathname: path.publicPathname,
      descriptor,
    });
  }
  const targets = [...pagesByPath.values()];
  const maxPages = runtime.config.corpus.runtime.maxPages;
  if (maxPages !== 'unlimited' && targets.length > maxPages) {
    throw new RuntimeCorpusLimitError(targets.length, maxPages);
  }

  const records = await collectConcurrently(targets, 1, async (target) => {
    const loaded = await fetchHtml(target.publicPathname);
    if (
      loaded === null || loaded.html === null || !loaded.response.ok ||
      loaded.response.status === 206 || !isIdentityEncoded(loaded.response)
    ) {
      cancelResponseBody(loaded?.response);
      return null;
    }
    const page = await pageFromHtml(target.pathname, loaded.html, runtime, {
      descriptor: target.descriptor,
      origin: opts.origin,
      publicPathname: target.publicPathname,
      rendererLoaders: opts.rendererLoaders,
      pluginLoaders: opts.pluginLoaders,
    });
    if (!page) return null;
    const enriched = await enrichRuntimePageGraph(loaded.html, page, runtime, {
      pluginLoaders: opts.pluginLoaders,
      catalogDescriptors: descriptors,
      allowGlobal: true,
    });
    if (enriched.isolated) {
      throw new RuntimeSchemaCorpusError('A runtime graph plugin isolated a collected page.');
    }
    if (enriched.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new RuntimeSchemaCorpusError('A collected page failed semantic validation.');
    }
    const graph = enriched.normalizedGraph ?? enriched.graph;
    return graph ? { page: enriched.page ?? page, graph } : null;
  });
  const graphPath = `${basePrefix(runtime.site.base)}${runtime.config.schema.corpus.graphPath}`;
  const pair = renderSchemaCorpus(records, {
    graphUrl: new URL(graphPath, siteUrl).href,
    strictReferences: runtime.config.schema.strictReferences,
  });
  return kind === 'schema-map' ? pair.map : pair.graph;
}

export class RuntimeSchemaCorpusError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`astro-aeo: ${message}`);
    this.name = 'RuntimeSchemaCorpusError';
  }
}

/** @param {unknown} value @returns {value is import('../page.js').PageDescriptor} */
function isPageDescriptor(value) {
  const descriptor = /** @type {any} */ (value);
  return Boolean(
    descriptor &&
    typeof descriptor === 'object' &&
    typeof descriptor.pathname === 'string' &&
    (descriptor.routePattern === undefined || typeof descriptor.routePattern === 'string') &&
    (descriptor.rendering === undefined || descriptor.rendering === 'prerendered' || descriptor.rendering === 'on-demand') &&
    (descriptor.title === undefined || typeof descriptor.title === 'string') &&
    (descriptor.description === undefined || typeof descriptor.description === 'string') &&
    (descriptor.image === undefined || typeof descriptor.image === 'string') &&
    (descriptor.language === undefined || typeof descriptor.language === 'string') &&
    (descriptor.markdown === undefined || typeof descriptor.markdown === 'string')
  );
}

/** @param {import('../page.js').PageDescriptor} value @param {string} pathname */
function isMinimalPageDescriptor(value, pathname) {
  return value.pathname === pathname && Object.keys(value).every((key) => key === 'pathname');
}

/** @param {unknown} value */
function isExtractionEnvelope(value) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    candidate.representations &&
    typeof candidate.representations === 'object' &&
    (candidate.representations.html === undefined || typeof candidate.representations.html === 'string') &&
    (candidate.representations.markdown === undefined || typeof candidate.representations.markdown === 'string') &&
    (candidate.representations.plainText === undefined || typeof candidate.representations.plainText === 'string') &&
    (candidate.extraction === null || candidate.extraction === undefined || typeof candidate.extraction === 'object') &&
    (candidate.source === undefined || (candidate.source && typeof candidate.source === 'object'))
  );
}

/** @param {unknown} value @returns {value is import('../core/page-model.js').AeoPage} */
function isPageRecord(value) {
  const page = /** @type {any} */ (value);
  return Boolean(
    page &&
    typeof page === 'object' &&
    typeof page.id === 'string' &&
    typeof page.pathname === 'string' &&
    typeof page.url === 'string' &&
    typeof page.mdHref === 'string' &&
    typeof page.title === 'string' &&
    typeof page.description === 'string' &&
    typeof page.markdown === 'string' &&
    (page.rendering === 'prerendered' || page.rendering === 'on-demand') &&
    Array.isArray(page.aeoTokens) && page.aeoTokens.every((/** @type {unknown} */ token) => typeof token === 'string') &&
    isPageMetadata(page.metadata) &&
    page.representations && typeof page.representations === 'object' &&
    Array.isArray(page.authors) &&
    Array.isArray(page.entities) &&
    page.directives && typeof page.directives === 'object'
  );
}

/** @param {unknown} value @returns {value is import('../core/page-model.js').AeoPage['metadata']} */
function isPageMetadata(value) {
  const metadata = /** @type {any} */ (value);
  return Boolean(
    metadata &&
    typeof metadata === 'object' &&
    typeof metadata.title === 'string' &&
    (metadata.description === undefined || typeof metadata.description === 'string') &&
    (metadata.image === undefined || typeof metadata.image === 'string') &&
    (metadata.canonicalSource === undefined || metadata.canonicalSource === 'authored' || metadata.canonicalSource === 'inferred')
  );
}

/** @param {unknown} value */
function isGraphEnvelope(value) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.html === 'string' &&
    isPageRecord(candidate.page) &&
    candidate.site && typeof candidate.site === 'object' &&
    (candidate.graph === null || (candidate.graph && Array.isArray(candidate.graph.entries))) &&
    (candidate.normalizedGraph === undefined || candidate.normalizedGraph === null ||
      (candidate.normalizedGraph && Array.isArray(candidate.normalizedGraph.entries))) &&
    typeof candidate.explicit === 'boolean'
  );
}

/**
 * @param {RuntimeCatalogLoader[]} loaders
 * @param {Runtime} runtime
 * @param {string} [origin]
 */
export function runtimeCatalogPagesFor(loaders, runtime, origin) {
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
    } catch {
      console.warn(
        `astro-aeo: the runtime page catalog "${loader.module}" failed and contributed nothing.`,
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
  const stableSiteUrl = runtime.site.stableSiteUrl ?? runtime.site.siteUrl;
  return siteUrl === runtime.site.siteUrl && stableSiteUrl === runtime.site.stableSiteUrl
    ? runtime.site
    : { ...runtime.site, siteUrl, stableSiteUrl };
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
export function catalogRuntimePath(pathname) {
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
