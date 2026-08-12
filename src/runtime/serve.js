// @ts-check
import { buildPage, basePrefix, pagePathForMdPath } from '../core/page-model.js';
import { createTurndown } from '../core/html-to-md.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import {
  isPotentialCorpusArtifactPath,
  planCorpusArtifacts,
} from '../core/corpus-artifacts.js';
import { buildRobotsTxt } from '../core/render/robots-txt.js';
import { buildDomainProfile } from '../core/render/domain-profile.js';
import { resolveSiteMeta } from '../core/site-meta.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';
import { inspectRootPathname, normalizeCatalogPathname } from '../core/match.js';
import { matchesExactPathname } from '../core/artifact-path.js';
import { cancelResponseBody, isIdentityEncoded, isNullBodyStatus } from './respond.js';
import { enrichHtmlHead, stripAeoHeadMarkers } from '../core/head.js';
import { renderSchemaCorpus } from '../core/schema-corpus.js';
import { siteScopeUrl, stableCanonical } from '../core/canonical.js';
import { catalogBreadcrumbTrail } from '../core/catalog-breadcrumbs.js';
import { reconcileSemanticEnvelope } from '../core/semantic-envelope.js';
import {
  isExtractionEnvelope,
  isGraphEnvelope,
  isPageDescriptor,
  isPageMetadata,
  isPageRecord,
} from '../core/plugin-validation.js';
import { loadRuntimeMarkdownRenderers } from './markdown-renderers.js';
import { loadRuntimePlugins } from './plugins.js';
import { loadRuntimeCorpusTokenizer } from './corpus-tokenizer.js';
import { parseDocument } from '../core/html-document.js';
import { readMarker } from '../core/extract/marker.js';
import {
  astroRouteLocale,
  normalizeOrigin,
  normalizePageAlternates,
  resolvePageLocale,
} from '../core/locale.js';

/**
 * @typedef {object} Runtime
 * @property {'dev'|'build'|'preview'} command
 * @property {import('../index.js').ResolvedAstroAeoConfig} config
 * @property {{ siteUrl: string; stableSiteUrl?: string; base: string; trailingSlash: 'always'|'never'|'ignore'; i18n?: import('../core/locale.js').LocaleSnapshot }} site
 * @property {boolean} [sitemapAvailable]
 * @property {string[]} staticPaths
 * @property {string[]} [projectPaths]
 * @property {RegExp[]} [projectPatterns]
 * @property {Record<string, { kind?: 'markdown'|'mdx'; body?: string; markdown?: string; path: string; hash?: string }>} standaloneSources
 */

/** @typedef {{ html: string | null; response: Response }} HtmlLoad */
/** @typedef {(pathname: string) => Promise<HtmlLoad | null>} HtmlFetcher */
/** @typedef {{ body: string | null; source: Response | null }} MarkdownResult */
/** @typedef {{ module: string; load: () => Promise<import('../page.js').PageCatalog> }} RuntimeCatalogLoader */
/** @typedef {import('./markdown-renderers.js').RuntimeMarkdownRendererLoader} RuntimeMarkdownRendererLoader */
/** @typedef {import('./plugins.js').RuntimePluginLoader} RuntimePluginLoader */
/** @typedef {import('./corpus-tokenizer.js').RuntimeCorpusTokenizerLoader} RuntimeCorpusTokenizerLoader */

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
  const configured = basePrefix(base);
  const prefix = inspectRootPathname(configured)?.decoded ?? configured;
  if (!prefix || (pathname !== prefix && !pathname.startsWith(`${prefix}/`))) return pathname;
  return pathname.slice(prefix.length) || '/';
}

/**
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {'robots'|'domain-profile'|'llms'|'llms-full'|'corpus'|'schema-graph'|'schema-map'|null}
 */
export function artifactFor(pathname, config) {
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return 'robots';
  if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) {
    return 'domain-profile';
  }
  if (pathname === '/llms.txt' && isPotentialCorpusArtifactPath(pathname, config)) return 'llms';
  if (pathname === '/llms-full.txt' && isPotentialCorpusArtifactPath(pathname, config)) return 'llms-full';
  if (isPotentialCorpusArtifactPath(pathname, config)) return 'corpus';
  if (config.schema.corpus.enabled && matchesExactPathname(pathname, config.schema.corpus.graphPath)) {
    return 'schema-graph';
  }
  if (config.schema.corpus.enabled && matchesExactPathname(pathname, config.schema.corpus.mapPath)) {
    return 'schema-map';
  }
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
 * @param {{ descriptor?: import('../page.js').PageDescriptor; allowAuthored?: boolean; origin?: string; publicPathname?: string; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; failOnPluginIsolation?: boolean }} [opts]
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
  // Catalog descriptors retain their authored URL spelling through every
  // lifecycle hook, as they do during a build. The decoded request pathname is
  // still used for routing and source lookup, while publicPathname owns links.
  const lifecyclePathname = descriptor?.pathname ?? pathname;
  /** @type {import('../index.js').Diagnostic[]} */
  const lifecycleDiagnostics = [];
  if (plugins) {
    const initialDescriptor = descriptor ?? { pathname: lifecyclePathname };
    const discovered = await plugins.run('page:discovered', initialDescriptor, {
      pathname: lifecyclePathname,
      validate: (value) => isPageDescriptor(value) && value.pathname === lifecyclePathname,
    });
    lifecycleDiagnostics.push(...discovered.diagnostics);
    if (discovered.isolated) return isolatedRuntimePage(opts, 'page:discovered');
    const candidate = /** @type {import('../page.js').PageDescriptor} */ (/** @type {unknown} */ (discovered.value));
    descriptor = configuredDescriptor !== undefined || !isMinimalPageDescriptor(candidate, lifecyclePathname)
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
        ...(typeof descriptor?.source?.hash === 'string'
          ? { hash: descriptor.source.hash }
          : typeof standalone?.hash === 'string'
            ? { hash: standalone.hash }
            : {}),
      }
    : undefined;
  const result = await buildPage({
    pathname: lifecyclePathname,
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
  let page = {
    ...result.page,
    ...(descriptor?.origin ? { origin: descriptor.origin } : {}),
    ...(descriptor?.locale ? { locale: descriptor.locale } : {}),
    ...(descriptor?.alternates ? { alternates: descriptor.alternates.map((alternate) => ({ ...alternate })) } : {}),
  };
  if (!plugins) return page;

  const extracted = await plugins.run('page:extract', {
    representations: page.representations,
    extraction: page.extraction ?? null,
    source: page.source,
  }, {
    pathname: lifecyclePathname,
    validate: isExtractionEnvelope,
  });
  lifecycleDiagnostics.push(...extracted.diagnostics);
  if (extracted.isolated) return isolatedRuntimePage(opts, 'page:extract');
  const extraction = /** @type {any} */ (extracted.value);
  page = {
    ...page,
    representations: extraction.representations,
    ...('extraction' in extraction ? { extraction: extraction.extraction ?? undefined } : {}),
    ...('source' in extraction ? { source: extraction.source ?? undefined } : {}),
    markdown: extraction.representations.markdown ?? '',
  };

  const transformed = await plugins.run('page:transform', page, {
    pathname: lifecyclePathname,
    validate: (value) => isPageRecord(value) && value.id === page.id && value.pathname === page.pathname,
  });
  lifecycleDiagnostics.push(...transformed.diagnostics);
  if (transformed.isolated) return isolatedRuntimePage(opts, 'page:transform');
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
    pathname: lifecyclePathname,
    validate: isPageMetadata,
  });
  if (metadata.isolated) return isolatedRuntimePage(opts, 'page:metadata');
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

  const inspected = enrichHtmlHead({
    html,
    page,
    config: runtime.config,
    site: runtime.site,
    allowGlobal: opts.allowGlobal ?? true,
    inspectAuthored: true,
    breadcrumbTrail: catalogBreadcrumbTrail(page.pathname, catalogDescriptors, runtime.site),
  });
  const baseline = { ...internal, authoredGraph: inspected.authoredGraph };
  const inspectedDiagnostics = uniqueDiagnostics([
    ...internal.diagnostics,
    ...inspected.diagnostics,
  ]);

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
    validate: (value) => isGraphEnvelope(value, {
      id: page.id,
      pathname: page.pathname,
      site: runtime.site,
    }),
  });
  if (semantic.isolated) {
    return {
      html: stripAeoHeadMarkers(html),
      page: internal.page,
      graph: null,
      normalizedGraph: undefined,
      explicit: internal.explicit,
      canonicalUrl: internal.canonicalUrl,
      diagnostics: uniqueDiagnostics([
        ...inspectedDiagnostics,
        ...semantic.diagnostics,
      ]),
      isolated: true,
    };
  }
  const reconciled = reconcileSemanticEnvelope({
    baseline,
    value: /** @type {any} */ (semantic.value),
    siteUrl: siteScopeUrl(runtime.site.siteUrl, runtime.site.base),
    strictReferences: runtime.config.schema.strictReferences,
    pathname: page.pathname,
  });
  if (!reconciled.valid) {
    return {
      html: stripAeoHeadMarkers(html),
      page: internal.page,
      graph: null,
      normalizedGraph: undefined,
      explicit: internal.explicit,
      canonicalUrl: internal.canonicalUrl,
      diagnostics: uniqueDiagnostics([
        ...inspectedDiagnostics,
        ...semantic.diagnostics,
        ...reconciled.diagnostics,
      ]),
      isolated: true,
    };
  }
  const value = reconciled.value;
  return {
    html: value.html,
    page: value.page,
    graph: value.graph,
    normalizedGraph: value.normalizedGraph,
    explicit: value.explicit,
    canonicalUrl: typeof value.page?.canonicalUrl === 'string'
      ? value.page.canonicalUrl
      : internal.canonicalUrl,
    diagnostics: uniqueDiagnostics([
      ...inspectedDiagnostics,
      ...semantic.diagnostics,
      ...reconciled.diagnostics,
    ]),
    isolated: false,
  };
}

/**
 * @param {string} mdPathname
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; origin?: string; publicPathname?: string; failOnPluginIsolation?: boolean; requireSuccessfulSource?: boolean }} [opts]
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
  if (opts.requireSuccessfulSource && !loaded.response.ok) {
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
      failOnPluginIsolation: opts.failOnPluginIsolation,
    },
  );
  if (!page || page.aeoTokens.includes('no-dotmd') || page.directives.generateMarkdown === false) {
    return { body: null, source: loaded.response };
  }
  return { body: renderMarkdownDocument(page, runtime.config), source: loaded.response };
}

/**
 * Collect the complete runtime page pipeline once and return the requested
 * logical corpus artifact. A null result means that the requested pathname is
 * not part of this host's deterministic plan.
 *
 * @param {string} pathname
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ note?: string; concurrency?: number; catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; tokenizerLoader?: RuntimeCorpusTokenizerLoader; origin?: string }} [opts]
 * @returns {Promise<{ body: string; contentType: string } | null>}
 */
export async function serveCorpusArtifact(pathname, runtime, fetchHtml, opts = {}) {
  const activeOrigin = effectiveSiteUrl(runtime, opts.origin);
  const descriptors = await runtimeCatalogPagesFor(
    opts.catalogLoaders ?? [],
    runtime,
    activeOrigin,
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
    async (target) => {
      const loaded = await fetchHtml(target.publicPathname);
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
      const page = await pageFromHtml(target.pathname, loaded.html, runtime, {
        descriptor: target.descriptor,
        origin: activeOrigin,
        publicPathname: target.publicPathname,
        rendererLoaders: opts.rendererLoaders,
        pluginLoaders: opts.pluginLoaders,
        failOnPluginIsolation: true,
      });
      if (!page) return null;
      const enriched = await enrichRuntimePageGraph(loaded.html, page, runtime, {
        pluginLoaders: opts.pluginLoaders,
        catalogDescriptors: descriptors,
        origin: activeOrigin,
        allowGlobal: true,
      });
      if (enriched.isolated) {
        throw new RuntimeCorpusPlanError('A runtime graph plugin isolated a collected page.');
      }
      const headAlternates = runtimeHeadAlternates(loaded.html);
      const semanticPage = {
        ...page,
        ...(enriched.page ?? {}),
        ...(target.descriptor?.origin ? { origin: target.descriptor.origin } : {}),
        ...(target.descriptor?.locale ? { locale: target.descriptor.locale } : {}),
        ...(headAlternates.present
          ? { alternates: headAlternates.value }
          : target.descriptor?.alternates
            ? { alternates: target.descriptor.alternates }
            : {}),
        representations: {
          ...page.representations,
          ...(enriched.page?.representations ?? {}),
          html: enriched.html,
        },
        diagnostics: uniqueDiagnostics([
          ...page.diagnostics,
          ...(enriched.page?.diagnostics ?? []),
          ...enriched.diagnostics,
        ]),
      };
      return {
        page: semanticPage,
        languageDeclaration: runtimeLanguageDeclaration(loaded.html, target.descriptor),
      };
    },
  );

  const snapshot = runtime.site.i18n ?? emptyLocaleSnapshot(activeOrigin);
  const localized = [];
  for (const collected of pages) {
    const page = collected.page;
    const routeLocale = astroRouteLocale(page.pathname, activeOrigin, snapshot);
    const languagePage = { ...page };
    if (collected.languageDeclaration.present) {
      languagePage.language = collected.languageDeclaration.value;
    } else {
      delete languagePage.language;
    }
    const resolved = resolvePageLocale(
      { ...languagePage, origin: normalizeOrigin(page.origin) ?? activeOrigin },
      snapshot,
      {
        unresolvedLanguage: runtime.config.i18n.unresolvedLanguage,
        siteDefaultLocale: runtime.config.site.defaultLocale,
      },
    );
    if (resolved.excluded) continue;
    localized.push({
      ...resolved.page,
      origin: expectedPageOrigin(resolved.page, routeLocale, snapshot, activeOrigin),
    });
  }
  if (snapshot.locales.length === 0) {
    const concrete = [...new Set(localized.flatMap((page) =>
      page.language && page.locale ? [page.language] : [],
    ))];
    if (concrete.length === 1) {
      for (let index = 0; index < localized.length; index++) {
        if (localized[index].locale == null) {
          localized[index] = { ...localized[index], locale: concrete[0], language: concrete[0] };
        }
      }
    }
  }
  const alternates = normalizePageAlternates(localized);
  const home = alternates.pages.find((page) => page.pathname === '/');
  const siteMeta = resolveSiteMeta(
    runtime.config,
    activeOrigin,
    home?.title ?? '',
  );
  const loadedTokenizer = await loadRuntimeCorpusTokenizer(opts.tokenizerLoader);
  const plan = await planCorpusArtifacts({
    pages: alternates.pages,
    config: runtime.config,
    siteMeta,
    origin: activeOrigin,
    base: runtime.site.base,
    i18n: snapshot,
    tokenizer: loadedTokenizer.implementation,
    tokenizerOptions: 'options' in loadedTokenizer ? loadedTokenizer.options : undefined,
    note: opts.note,
  });
  if (plan.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new RuntimeCorpusPlanError('The runtime corpus plan failed validation.');
  }
  const requested = plan.artifacts.find((artifact) => artifact.pathname === pathname);
  if (requested) return { body: requested.contents, contentType: 'text/plain; charset=utf-8' };
  if (pathname === '/llms/manifest.json' && plan.manifestText) {
    return { body: plan.manifestText, contentType: 'application/json; charset=utf-8' };
  }
  return null;
}

/**
 * Backward-compatible entry used by direct consumers and the existing test
 * suite. It delegates to the same complete planner used by middleware.
 * @param {'llms'|'llms-full'} kind
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ note?: string; concurrency?: number; catalogLoaders?: RuntimeCatalogLoader[]; rendererLoaders?: RuntimeMarkdownRendererLoader[]; pluginLoaders?: RuntimePluginLoader[]; tokenizerLoader?: RuntimeCorpusTokenizerLoader; origin?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function serveLlmsIndex(kind, runtime, fetchHtml, opts = {}) {
  const pathname = kind === 'llms-full' ? '/llms-full.txt' : '/llms.txt';
  const result = await serveCorpusArtifact(pathname, runtime, fetchHtml, opts);
  return result?.body ?? '';
}

export class RuntimeCorpusPlanError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`astro-aeo: ${message}`);
    this.name = 'RuntimeCorpusPlanError';
  }
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
    let page;
    try {
      page = await pageFromHtml(target.pathname, loaded.html, runtime, {
        descriptor: target.descriptor,
        origin: opts.origin,
        publicPathname: target.publicPathname,
        rendererLoaders: opts.rendererLoaders,
        pluginLoaders: opts.pluginLoaders,
        failOnPluginIsolation: true,
      });
    } catch (error) {
      if (error instanceof RuntimePageLifecycleError) {
        throw new RuntimeSchemaCorpusError('A runtime page plugin isolated a collected page.');
      }
      throw error;
    }
    if (!page) return null;
    const enriched = await enrichRuntimePageGraph(loaded.html, page, runtime, {
      pluginLoaders: opts.pluginLoaders,
      catalogDescriptors: descriptors,
      allowGlobal: true,
    });
    if (enriched.isolated) {
      throw new RuntimeSchemaCorpusError('A runtime graph plugin isolated a collected page.');
    }
    const diagnostics = [
      ...page.diagnostics,
      ...(enriched.page?.diagnostics ?? []),
      ...enriched.diagnostics,
    ];
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new RuntimeSchemaCorpusError('A collected page failed semantic validation.');
    }
    const graph = enriched.normalizedGraph ?? enriched.graph;
    return graph ? { page: enriched.page ?? page, graph } : null;
  });
  const graphPath = `${basePrefix(runtime.site.base)}${runtime.config.schema.corpus.graphPath}`;
  const pair = renderSchemaCorpus(records, {
    graphUrl: new URL(graphPath, siteUrl).href,
    siteUrl: siteScopeUrl(siteUrl, runtime.site.base) ?? siteUrl,
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

export class RuntimePageLifecycleError extends Error {
  /** @param {string} stage */
  constructor(stage) {
    super(`astro-aeo: a runtime page plugin isolated ${stage}.`);
    this.name = 'RuntimePageLifecycleError';
  }
}

/**
 * Ordinary page and Markdown callers retain the established null result when a
 * plugin is isolated. Ownership and corpus callers opt into an exception so a
 * failed lifecycle cannot silently transfer or omit output.
 *
 * @param {{ failOnPluginIsolation?: boolean }} opts
 * @param {string} stage
 * @returns {null}
 */
function isolatedRuntimePage(opts, stage) {
  if (opts.failOnPluginIsolation) throw new RuntimePageLifecycleError(stage);
  return null;
}

/** @param {import('../index.js').Diagnostic[]} diagnostics */
function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([
      diagnostic.version,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.pathname ?? null,
      diagnostic.sourcePath ?? null,
      diagnostic.details ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {import('../page.js').PageDescriptor} value @param {string} pathname */
function isMinimalPageDescriptor(value, pathname) {
  return value.pathname === pathname && Object.keys(value).every((key) => key === 'pathname');
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
        const descriptorOrigin = value?.origin === undefined ? null : normalizeOrigin(value.origin);
        if (value?.origin !== undefined && descriptorOrigin === null) {
          console.warn('astro-aeo: a runtime page catalog returned an invalid origin; its descriptor was ignored.');
          continue;
        }
        const configuredSiteOrigin = normalizeOrigin(runtime.site.siteUrl);
        const configuredOrigins = new Set([
          ...(runtime.site.i18n?.origins ?? []),
          ...(configuredSiteOrigin ? [configuredSiteOrigin] : []),
        ]);
        if (descriptorOrigin && (!configuredOrigins.has(descriptorOrigin) || descriptorOrigin !== normalizeOrigin(siteUrl))) {
          console.warn('astro-aeo: a runtime page catalog origin did not match the active configured Astro origin; its descriptor was ignored.');
          continue;
        }
        const pathname = normalizeCatalogPathname(value?.pathname);
        if (pathname === null) {
          console.warn('astro-aeo: a runtime page catalog returned an unsafe or non-root-relative pathname; it was ignored.');
          continue;
        }
        const canonicalPathname = catalogRuntimePath(pathname).canonical;
        const identity = `${descriptorOrigin ?? normalizeOrigin(siteUrl) ?? ''}\0${canonicalPathname}`;
        if (seen.has(identity)) {
          console.warn(`astro-aeo: more than one runtime catalog described ${pathname}; the first descriptor wins.`);
          continue;
        }
        seen.add(identity);
        descriptors.push({ ...value, pathname, ...(descriptorOrigin ? { origin: descriptorOrigin } : {}) });
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
  const requestOrigin = normalizeOrigin(origin ?? '');
  const configuredOrigins = runtime.site.i18n?.origins ?? [];
  if (requestOrigin && configuredOrigins.includes(requestOrigin)) return requestOrigin;
  return runtime.site.siteUrl || requestOrigin || '';
}

/**
 * Resolve the exact configured host allowed to serve origin-scoped artifacts.
 * Projects without a stable site retain the historical request-origin mode.
 * @param {Runtime} runtime
 * @param {string} requestOrigin
 * @returns {string|null}
 */
export function runtimeArtifactOrigin(runtime, requestOrigin) {
  const requested = normalizeOrigin(requestOrigin);
  if (!requested) return null;
  const configured = [...new Set([
    ...(runtime.site.i18n?.origins ?? []),
    ...(normalizeOrigin(runtime.site.siteUrl) ? [/** @type {string} */ (normalizeOrigin(runtime.site.siteUrl))] : []),
  ])];
  if (configured.length === 0) return requested;
  if (configured.includes(requested)) return requested;
  // The Astro dev server necessarily runs on a local preview origin while
  // generated links and host profiles retain the configured public site.
  if (isLocalDevelopmentOrigin(requested)) {
    return normalizeOrigin(runtime.site.siteUrl) ?? requested;
  }
  return null;
}

/** @param {string} origin */
function isLocalDevelopmentOrigin(origin) {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
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

/** @param {any} page @param {any} routeLocale @param {import('../core/locale.js').LocaleSnapshot} snapshot @param {string} activeOrigin */
function expectedPageOrigin(page, routeLocale, snapshot, activeOrigin) {
  if (!snapshot.primaryOrigin && snapshot.origins.length === 0) return activeOrigin;
  const locale = snapshot.locales.find((entry) => entry.locale === page.locale) ?? routeLocale;
  const expected = normalizeOrigin(locale?.origin) ?? normalizeOrigin(snapshot.primaryOrigin);
  return expected ?? normalizeOrigin(page.origin) ?? activeOrigin;
}

/** @param {string} origin @returns {import('../core/locale.js').LocaleSnapshot} */
function emptyLocaleSnapshot(origin) {
  const normalized = normalizeOrigin(origin) ?? undefined;
  return {
    locales: [],
    ...(normalized ? { primaryOrigin: normalized } : {}),
    origins: normalized ? [normalized] : [],
    prefixDefaultLocale: false,
    manual: false,
  };
}

/**
 * Preserve declaration provenance until semantic enrichment is complete. The
 * legacy page model exposes only the resolved string, which would otherwise
 * let site.defaultLocale incorrectly outrank Astro route and i18n defaults.
 * @param {string} html
 * @param {import('../page.js').PageDescriptor | undefined} descriptor
 * @returns {{ present: boolean; value?: any }}
 */
function runtimeLanguageDeclaration(html, descriptor) {
  try {
    const document = parseDocument(html);
    const headMarker = document.querySelector('script[data-astro-aeo-head]');
    if (headMarker) {
      try {
        const value = JSON.parse(headMarker.textContent ?? '');
        if (value && typeof value === 'object' && Object.hasOwn(value, 'locale')) {
          return { present: true, value: value.locale };
        }
      } catch {}
    }
    const marker = readMarker(document);
    if (marker && Object.hasOwn(marker, 'language')) {
      return { present: true, value: marker.language };
    }
    if (descriptor && Object.hasOwn(descriptor, 'language')) {
      return { present: true, value: descriptor.language };
    }
    const root = document.documentElement;
    if (root?.hasAttribute('lang')) return { present: true, value: root.getAttribute('lang') };
  } catch {}
  return { present: false };
}

/** @param {string} html @returns {{ present: boolean; value: any[] }} */
function runtimeHeadAlternates(html) {
  try {
    const document = parseDocument(html);
    const marker = document.querySelector('script[data-astro-aeo-head]');
    if (!marker) return { present: false, value: [] };
    const value = JSON.parse(marker.textContent ?? '');
    if (value && typeof value === 'object' && Object.hasOwn(value, 'hreflang')) {
      return {
        present: true,
        value: Array.isArray(value.hreflang)
          ? value.hreflang.map((/** @type {any} */ alternate) => ({
              language: alternate?.language ?? alternate?.lang,
              url: alternate?.url ?? alternate?.href,
            }))
          : [],
      };
    }
  } catch {}
  return { present: false, value: [] };
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
