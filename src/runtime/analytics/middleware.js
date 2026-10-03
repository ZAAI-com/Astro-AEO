// @ts-check
import { cachedRuntimeCatalogPages } from '../serve.js';
import { createAnalytics } from './observe.js';
import { createConsoleSink } from './delivery.js';
import { mdPathnameFor, basePrefix } from '../../core/page-model.js';
import { corpusRoutePatterns } from '../../core/corpus-topology.js';

/**
 * Enabled-only wrapper. Capture public request facts before Astro rewrites its
 * context; internal re-entries are filtered by the original middleware's state.
 * @param {(context: import('astro').APIContext, next: import('astro').MiddlewareNext) => Promise<Response>} middleware
 * @param {(context: import('astro').APIContext) => boolean} internal
 * @param {import('../serve.js').Runtime} runtime
 * @param {import('../../analytics.js').AnalyticsObserverOptions} options
 * @param {import('../../analytics.js').AnalyticsSink} sink
 * @returns {import('astro').MiddlewareHandler}
 */
export function createAnalyticsMiddleware(middleware, internal, runtime, options, sink) {
  const base = basePrefix(runtime.site.base);
  let paths = runtime.staticPaths.map((path) => `${base}${path}`);
  let artifacts = runtime.config.markdown.enabled ? runtime.staticPaths.map((path) => `${base}${mdPathnameFor(path)}`) : [];
  const pagePatterns = (runtime.routePatterns ?? []).map(({ pattern, routePattern }) => ({
    pattern: base && !routePattern.startsWith(`${base}/`) ? new RegExp(`^${escape(base)}${pattern.source.replace(/^\^/, '')}`, pattern.flags) : pattern,
    routePattern: base && !routePattern.startsWith(`${base}/`) ? `${base}${routePattern}` : routePattern,
  }));
  const artifactPatterns = corpusRoutePatterns(runtime.config);
  if (runtime.config.corpus.compression.gzip) artifactPatterns.push(...artifactPatterns.filter((path) => path.endsWith('.txt')).map((path) => `${path}.gz`));
  if (runtime.config.discovery.robots.enabled) artifactPatterns.push('/robots.txt');
  if (runtime.config.site.profile.enabled) artifactPatterns.push('/.well-known/domain-profile.json');
  if (runtime.config.schema.corpus.enabled) artifactPatterns.push(runtime.config.schema.corpus.graphPath, runtime.config.schema.corpus.mapPath);
  for (const plugin of /** @type {any} */ (runtime).pluginManifest?.plugins ?? []) for (const claim of plugin.claims) artifactPatterns.push(claim.pathname);
  for (const path of artifactPatterns) if (!path.includes('[')) artifacts.push(`${base}${path}`);
  const initialArtifacts = artifacts;
  const consoleSink = createConsoleSink();
  const observer = createAnalytics({ ...options, base, inventory: () => paths, artifacts: () => artifacts,
    patterns: [...(runtime.config.markdown.enabled ? pagePatterns.map(({ routePattern }) => ({
      pattern: routeRegex(mdPathnameFor(routePattern)), routePattern: mdPathnameFor(routePattern), artifact: true,
    })) : []), ...artifactPatterns.filter((path) => path.includes('[')).map((path) => ({
      pattern: routeRegex(`${base}${path}`), routePattern: `${base}${path}`, artifact: true,
    })), ...pagePatterns],
    sink: runtime.command === 'dev' && options.adapter?.type !== 'console'
      ? async (event) => { consoleSink(event); await sink(event); } : sink,
  });
  /** @type {Promise<import('../../page.js').PageDescriptor[]> | undefined} */
  let catalog;
  return async (context, next) => {
    const details = { pathname: context.url.pathname, internal: internal(context),
      prerendered: runtime.command === 'build' && context.isPrerendered,
      waitUntil: lifetime(context) };
    const request = context.request;
    const response = await middleware(context, next);
    if (!details.internal && !details.prerendered && ['GET', 'HEAD'].includes(request.method)) {
      const known = cachedRuntimeCatalogPages(runtime);
      if (known && known !== catalog) {
        try {
          const descriptors = await known;
          paths = [...new Set([...runtime.staticPaths, ...descriptors.map((page) => page.pathname)])].map((path) => `${base}${path}`);
          if (runtime.config.markdown.enabled) artifacts = [...new Set([...initialArtifacts, ...descriptors.map((page) => `${base}${mdPathnameFor(page.pathname)}`)])];
          catalog = known;
        } catch { /* A failed inventory does not affect visitor HTTP. */ }
      }
    }
    return observer.observe(request, response, details);
  };
}
/** Match only declared route mechanics, never expose matched parameter values. @param {string} path */
function routeRegex(path) {
  return new RegExp(`^${path.split(/(\[.*?\])/).map((part) => part.startsWith('[...') ? '.+' : part.startsWith('[')
    ? '[^/]+' : escape(part)).join('')}/?$`);
}
/** Only documented provider-local lifetimes, no request data or private Astro state. @param {import('astro').APIContext} context @returns {((work: Promise<void>) => void) | undefined} */
function lifetime(context) {
  const locals = /** @type {{ waitUntil?: (work: Promise<void>) => void; cfContext?: { waitUntil?: (work: Promise<void>) => void } }} */ (context.locals);
  if (typeof locals.waitUntil === 'function') return locals.waitUntil.bind(locals);
  if (typeof locals.cfContext?.waitUntil === 'function') return locals.cfContext.waitUntil.bind(locals.cfContext);
  return undefined;
}

/** @param {string} value */
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
