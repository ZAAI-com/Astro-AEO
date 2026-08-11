// @ts-check
import {
  RUNTIME,
  RUNTIME_CATALOG_LOADERS,
  RUNTIME_MARKDOWN_RENDERER_LOADERS,
  RUNTIME_PLUGIN_LOADERS,
} from './config.js';
import { mdPathnameFor, pagePathForMdPath, basePrefix } from '../core/page-model.js';
import { inspectRootPathname, isIncluded, normalizePath } from '../core/match.js';
import { extractPageMeta } from '../core/page-meta.js';
import { COLLECT_FLAG, stripMarkersFromHtml } from '../core/extract/marker.js';
import { stripAeoHeadMarkers } from '../core/head.js';
import { withMarkdownAlternateLink } from '../core/alternate-link.js';
import { prefersMarkdown } from './negotiate.js';
import {
  cancelResponseBody,
  etagFor,
  MARKDOWN_CONTENT_TYPE,
  inheritedRepresentationHeaders,
  isHtmlResponse,
  isIdentityEncoded,
  isNotModified,
  isNullBodyStatus,
  isUtf8HtmlResponse,
  responseBodyForbidden,
  stripRepresentationMetadata,
  textResponse,
  transformedHtmlContentType,
} from './respond.js';
import {
  artifactFor,
  enrichRuntimePageGraph,
  pageFromHtml,
  renderStandaloneArtifact,
  RuntimeCorpusLimitError,
  serveLlmsIndex,
  serveMarkdown,
  serveSchemaCorpus,
  stripBase,
} from './serve.js';
import {
  createRuntimePluginPageHandles,
  runtimePluginArtifactFor,
  serveRuntimePluginArtifact,
} from './plugins.js';

const DEV_NOTE =
  '<!-- astro-aeo dev preview: dynamic routes are omitted; run `astro build` for the full file -->';
const INTERNAL_REQUEST_HEADER = 'x-astro-aeo-internal';
const INTERNAL_PURPOSE_HEADER = 'x-astro-aeo-internal-purpose';
const CORPUS_PURPOSE = 'corpus';
const LEGACY_CORPUS_UNAVAILABLE =
  'astro-aeo: request-time corpora require Astro 6.3 or newer so every page can render in a disposable request state; use build output on Astro 5 or Astro 6.0-6.2.\n';
/** @type {WeakMap<object, { collect: boolean; corpus: boolean }>} */
const INTERNAL_REWRITES = new WeakMap();
const ASTRO_FETCH_STATE = Symbol.for('astro.fetchState');
const ASTRO_5_PIPELINE = Symbol.for('context.routes');
const ASTRO_6_LEGACY_PIPELINE = Symbol.for('astro.pipeline');

/**
 * @param {import('astro').APIContext} context
 * @param {import('astro').MiddlewareNext} next
 * @returns {Promise<Response>}
 */
export const onRequest = async (context, next) => {
  if (RUNTIME.command === 'build' && context.isPrerendered) {
    return withCollectionFlag(context, true, async () => {
      const response = await next();
      const body = await bufferedInternalBody(response, context.request);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
  }

  const internal = INTERNAL_REWRITES.get(context.locals);
  if (internal) {
    return withCollectionFlag(context, internal.collect, async () => {
      const response = await next();
      return internal.corpus
        ? isolateCorpusResponse(response, context.request)
        : isolateInternalResponse(response, context.request, internal.collect);
    });
  }

  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return redactAeoHeadMarkers(await next(), context.request);
  }
  const originalRequest = context.request;
  const originalOrigin = context.url.origin;
  const originalSearch = context.url.search;

  const decoded = decodePathname(context.url.pathname);
  if (decoded === null) return new Response(null, { status: 400 });
  const configuredBase = basePrefix(RUNTIME.site.base);
  if (
    configuredBase &&
    decoded !== configuredBase &&
    !decoded.startsWith(`${configuredBase}/`)
  ) {
    return next();
  }
  const pathname = stripBase(decoded, RUNTIME.site.base);
  const encodedPathname = encodeURI(pathname);

  const replacementAuthorized = RUNTIME.config.artifacts.replace.includes(
    normalizePath(decoded),
  );
  const projectOwned = !replacementAuthorized && ownedByProject(pathname, encodedPathname);
  const artifact = projectOwned ? null : artifactFor(pathname, RUNTIME.config);
  const pluginTarget = runtimePluginArtifactFor(pathname, RUNTIME_PLUGIN_LOADERS, {
    projectOwned,
    coreOwned: Boolean(artifact),
  });
  if (pluginTarget) {
    const response = await serveRuntimePluginArtifact(
      pluginTarget,
      context.request,
      RUNTIME_PLUGIN_LOADERS,
      runtimePluginPageHandles(context, next),
      RUNTIME.command,
    );
    if (response) return response;
  }
  if (artifact === 'robots' || artifact === 'domain-profile') {
    const { body, contentType } = renderStandaloneArtifact(artifact, RUNTIME, {
      sitemapAvailable: RUNTIME.sitemapAvailable,
      origin: context.url.origin,
    });
    return textResponse({ body, contentType, request: context.request });
  }
  if (artifact === 'schema-graph' || artifact === 'schema-map') {
    if (!disposableCorpusStateFor(context)) {
      return textResponse({
        body: LEGACY_CORPUS_UNAVAILABLE,
        contentType: 'text/plain; charset=utf-8',
        request: context.request,
        status: 503,
        headers: { 'cache-control': 'no-store' },
      });
    }
    try {
      const { body, contentType } = await serveSchemaCorpus(
        artifact,
        RUNTIME,
        htmlFetcher(context, next, { sanitizeCredentials: true }),
        {
          catalogLoaders: RUNTIME_CATALOG_LOADERS,
          rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
          pluginLoaders: RUNTIME_PLUGIN_LOADERS,
          origin: context.url.origin,
        },
      );
      return textResponse({ body, contentType, request: context.request });
    } catch {
      return textResponse({
        body: 'astro-aeo: the semantic corpus is temporarily unavailable.\n',
        contentType: 'text/plain; charset=utf-8',
        request: context.request,
        status: 500,
        headers: { 'cache-control': 'no-store' },
      });
    }
  }
  if (artifact === 'llms' || artifact === 'llms-full') {
    if (!disposableCorpusStateFor(context)) {
      return textResponse({
        body: LEGACY_CORPUS_UNAVAILABLE,
        contentType: 'text/plain; charset=utf-8',
        request: context.request,
        status: 503,
        headers: { 'cache-control': 'no-store' },
      });
    }
    try {
      const body = await serveLlmsIndex(artifact, RUNTIME, htmlFetcher(context, next, { sanitizeCredentials: true }), {
        note: RUNTIME.command === 'dev' ? DEV_NOTE : undefined,
        concurrency: 1,
        catalogLoaders: RUNTIME_CATALOG_LOADERS,
        rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
        pluginLoaders: RUNTIME_PLUGIN_LOADERS,
        origin: context.url.origin,
      });
      return textResponse({ body, contentType: 'text/plain; charset=utf-8', request: context.request });
    } catch (error) {
      if (!(error instanceof RuntimeCorpusLimitError)) throw error;
      return textResponse({
        body: `${error.message}\n`,
        contentType: 'text/plain; charset=utf-8',
        request: context.request,
        status: 503,
        headers: { 'cache-control': 'no-store' },
      });
    }
  }

  const mdPagePath = pagePathForMdPath(pathname);
  const encodedMdPagePath = pagePathForMdPath(encodedPathname) ??
    (mdPagePath === null ? null : encodeURI(mdPagePath));
  if (RUNTIME.config.markdown.enabled && mdPagePath !== null && !projectOwned) {
    const rewritePathname = encodedMdPagePath ?? mdPagePath;
    const probe = htmlFetcher(context, next, {
      preserveQuery: true,
      rewritePathname,
      collect: false,
    });
    const collected = htmlFetcher(context, next, { preserveQuery: true, rewritePathname });
    const fetcher = async (sourcePathname) => {
      const safe = await probe(sourcePathname);
      if (safe === null || safe.html === null || !safe.response.ok) return safe;
      const authored = await collected(sourcePathname);
      if (authored !== null && authored.html !== null) return authored;
      cancelResponseBody(authored?.response);
      return safe;
    };
    const { body, source } = await serveMarkdown(pathname, RUNTIME, fetcher, {
      catalogLoaders: RUNTIME_CATALOG_LOADERS,
      rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
      pluginLoaders: RUNTIME_PLUGIN_LOADERS,
      origin: context.url.origin,
      publicPathname: encodedMdPagePath ?? mdPagePath,
    });
    if (body === null) {
      if (
        source &&
        source.status !== 206 &&
        (isNullBodyStatus(source.status) ||
          !isHtmlResponse(source) ||
          (source.status >= 300 && source.status < 400))
      ) {
        return forwardSourceResponse(source, {
          request: originalRequest,
          origin: originalOrigin,
          search: originalSearch,
        }, encodedMdPagePath ?? mdPagePath);
      }
      cancelResponseBody(source);
      return new Response(null, { status: source && !source.ok ? source.status : 404 });
    }
    return textResponse({
      body,
      contentType: MARKDOWN_CONTENT_TYPE,
      request: context.request,
      status: source?.status ?? 200,
      headers: representationHeaders(source, encodedMdPagePath ?? mdPagePath, context, false),
    });
  }

  const negotiation = RUNTIME.config.markdown.enabled
    ? RUNTIME.config.markdown.negotiation
    : 'off';
  const wantsMarkdown =
    negotiation !== 'off' && prefersMarkdown(context.request.headers.get('accept'));
  const pagePath = normalizePath(pathname);
  const encodedPagePath = normalizePath(encodedPathname);
  const response = await next();
  const conditionalRetry = response.status === 304;
  if (isNullBodyStatus(response.status) && !conditionalRetry) return response;
  if (!conditionalRetry) {
    if (!isHtmlResponse(response)) return response;
    if (!isUtf8HtmlResponse(response) || !isIdentityEncoded(response) || response.status === 206) {
      return response;
    }
    if (response.status >= 300 && response.status < 400) {
      return redactAeoHeadMarkers(response, context.request);
    }
    if (!response.ok) return redactAeoHeadMarkers(response, context.request);
  }

  let decisionResponse = response;
  let html;
  if (conditionalRetry || method === 'HEAD') {
    const probe = await htmlFetcher(context, next, {
      preserveQuery: true,
      rewritePathname: encodedPagePath,
      collect: false,
    })(encodedPagePath);
    if (probe === null || probe.html === null || !probe.response.ok) {
      cancelResponseBody(probe?.response);
      return response;
    }
    decisionResponse = probe.response;
    html = probe.html;
  } else {
    html = await response.clone().text();
  }
  const cleanHtml = stripMarkersFromHtml(html);
  const eligible = RUNTIME.config.markdown.enabled && isMarkdownEligible(pagePath, cleanHtml);
  const vary = negotiation !== 'off';

  if (wantsMarkdown && eligible && negotiation === 'redirect') {
    const headers = representationHeaders(decisionResponse, encodedPagePath, context, true);
    headers.set(
      'location',
      `${basePrefix(RUNTIME.site.base)}${mdPathnameFor(encodedPagePath)}${context.url.search}`,
    );
    cancelResponseBody(response);
    return new Response(null, {
      status: 303,
      headers,
    });
  }

  if (wantsMarkdown && eligible) {
    const { body, source } = await serveMarkdown(
      mdPathnameFor(pagePath),
      RUNTIME,
      htmlFetcher(context, next, {
        preserveQuery: true,
        rewritePathname: encodedPagePath,
      }),
      {
        catalogLoaders: RUNTIME_CATALOG_LOADERS,
        rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
        pluginLoaders: RUNTIME_PLUGIN_LOADERS,
        origin: context.url.origin,
        publicPathname: encodedPagePath,
      },
    );
    if (body !== null && source?.ok) {
      cancelResponseBody(response);
      return textResponse({
        body,
        contentType: MARKDOWN_CONTENT_TYPE,
        request: context.request,
        status: source.status,
        headers: representationHeaders(source, encodedPagePath, context, true),
      });
    }
    cancelResponseBody(source);
  }

  const mode = RUNTIME.config.markdown.enabled
    ? RUNTIME.config.markdown.alternateLink
    : 'never';
  const href = `${basePrefix(RUNTIME.site.base)}${mdPathnameFor(encodedPagePath)}`;
  let output = eligible && mode !== 'never'
    ? withMarkdownAlternateLink(cleanHtml, href, mode)
    : cleanHtml;

  if (isSemanticEligible(pagePath, cleanHtml)) {
    try {
      const page = await pageFromHtml(pagePath, cleanHtml, RUNTIME, {
        origin: context.url.origin,
        publicPathname: encodedPagePath,
        rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
        pluginLoaders: RUNTIME_PLUGIN_LOADERS,
      });
      if (page) {
        output = (await enrichRuntimePageGraph(output, page, RUNTIME, {
          pluginLoaders: RUNTIME_PLUGIN_LOADERS,
          allowGlobal: true,
        })).html;
      } else {
        output = stripAeoHeadMarkers(output);
      }
    } catch {
      // Semantic enrichment must never make the application response
      // unavailable. The inert component transport is still always redacted.
      output = stripAeoHeadMarkers(output);
    }
  } else {
    output = stripAeoHeadMarkers(output);
  }

  const changed = output !== html;
  if (conditionalRetry && !changed) return response;
  if (!vary && !changed) return response;
  return htmlResponse(output, conditionalRetry ? decisionResponse : response, context.request, {
    vary,
    changed,
  });
};

/**
 * Enumerated, zero-argument handles are the only page access runtime plugins
 * receive. Reads use anonymous disposable request state and cannot choose a
 * target, forward caller credentials, or expose source and HTML payloads.
 * @param {import('astro').APIContext} context
 * @param {import('astro').MiddlewareNext} next
 */
function runtimePluginPageHandles(context, next) {
  const fetch = htmlFetcher(context, next, { sanitizeCredentials: true });
  return createRuntimePluginPageHandles(
    RUNTIME.staticPaths.map((pathname) => ({ id: pathname, pathname })),
    async ({ pathname }) => {
      const publicPathname = encodeURI(pathname);
      const loaded = await fetch(publicPathname);
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
      return pageFromHtml(pathname, loaded.html, RUNTIME, {
        origin: context.url.origin,
        publicPathname,
        rendererLoaders: RUNTIME_MARKDOWN_RENDERER_LOADERS,
        pluginLoaders: RUNTIME_PLUGIN_LOADERS,
      });
    },
  );
}

/** @param {string} pathname @param {string} html */
function isMarkdownEligible(pathname, html) {
  const { config } = RUNTIME;
  if (!isIncluded(pathname, config.pages)) return false;
  const meta = extractPageMeta(html);
  return !meta.isRedirect &&
    !(config.pages.respectNoindex && meta.noindex) &&
    !meta.aeoTokens.has('skip') &&
    !meta.aeoTokens.has('no-dotmd');
}

/** @param {string} pathname @param {string} html */
function isSemanticEligible(pathname, html) {
  const { config } = RUNTIME;
  if (!isIncluded(pathname, config.pages)) return false;
  const meta = extractPageMeta(html);
  return !meta.isRedirect &&
    !(config.pages.respectNoindex && meta.noindex) &&
    !meta.aeoTokens.has('skip');
}

/**
 * @param {string} html
 * @param {Response} source
 * @param {Request} request
 * @param {{ vary: boolean; changed: boolean }} options
 */
async function htmlResponse(html, source, request, options) {
  const headers = new Headers(source.headers);
  if (options.changed) {
    stripRepresentationMetadata(headers);
    headers.set('content-type', transformedHtmlContentType(source));
    const etag = await etagFor(html);
    headers.set('etag', etag);
    if (
      source.ok &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      isNotModified(request, etag)
    ) {
      cancelResponseBody(source);
      headers.delete('content-type');
      return new Response(null, { status: 304, headers });
    }
  }
  if (options.vary) headers.set('vary', mergeCommaHeader(headers.get('vary'), 'Accept'));
  const forbidden = responseBodyForbidden(request, source.status);
  if (options.changed || forbidden) cancelResponseBody(source);
  const body = forbidden
    ? null
    : options.changed
      ? html
      : source.body;
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * Redact an explicit AeoHead transport marker from an HTML response that is
 * not eligible for semantic enrichment. Opaque or encoded bytes stay intact.
 * @param {Response} response
 * @param {Request} request
 */
async function redactAeoHeadMarkers(response, request) {
  if (
    responseBodyForbidden(request, response.status) ||
    !isUtf8HtmlResponse(response) ||
    !isIdentityEncoded(response) ||
    response.status === 206
  ) {
    return response;
  }
  let html;
  try {
    html = await response.clone().text();
  } catch {
    return response;
  }
  const output = stripAeoHeadMarkers(html);
  if (output === html) return response;
  return htmlResponse(output, response, request, { vary: false, changed: true });
}

/**
 * Scope the component source marker to a single in-process render. The trusted
 * reentry state lives in a WeakMap keyed by Astro's shared locals object, never
 * in an application-visible request header.
 * @template T
 * @param {import('astro').APIContext} context
 * @param {boolean} collect
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withCollectionFlag(context, collect, run) {
  const locals = /** @type {Record<string, unknown>} */ (context.locals);
  const hadValue = Object.prototype.hasOwnProperty.call(locals, COLLECT_FLAG);
  const previous = locals[COLLECT_FLAG];
  if (collect) locals[COLLECT_FLAG] = true;
  else delete locals[COLLECT_FLAG];
  try {
    return await run();
  } finally {
    if (hadValue) locals[COLLECT_FLAG] = previous;
    else delete locals[COLLECT_FLAG];
  }
}

/** @param {string} pathname @param {string} encodedPathname @returns {boolean} */
function ownedByProject(pathname, encodedPathname) {
  if ((RUNTIME.projectPaths ?? RUNTIME.staticPaths).includes(pathname)) return true;
  return RUNTIME.projectPatterns?.some((pattern) => {
    for (const candidate of pathname === encodedPathname
      ? [pathname]
      : [pathname, encodedPathname]) {
      pattern.lastIndex = 0;
      if (pattern.test(candidate)) {
        pattern.lastIndex = 0;
        return true;
      }
    }
    pattern.lastIndex = 0;
    return false;
  }) ?? false;
}

/**
 * @param {import('astro').APIContext} context
 * @param {import('astro').MiddlewareNext} next
 * @param {{ preserveQuery?: boolean; sanitizeCredentials?: boolean; rewritePathname?: string; collect?: boolean }} [opts]
 * @returns {import('./serve.js').HtmlFetcher}
 */
function htmlFetcher(context, next, opts = {}) {
  const sourceRequest = context.request;
  const origin = context.url.origin;
  const search = context.url.search;
  const outerLocals = snapshotLocals(context.locals);
  let tail = Promise.resolve();

  /** @param {string} pathname */
  const loadOne = async (pathname) => {
    const sourcePathname = opts.rewritePathname ?? pathname;
    const target = `${basePrefix(RUNTIME.site.base)}${withTrailingSlash(sourcePathname)}${opts.preserveQuery ? search : ''}`;
    try {
      const targetUrl = new URL(target, origin);
      const headers = opts.sanitizeCredentials
        ? new Headers()
        : new Headers(sourceRequest.headers);
      sanitizeSourceHeaders(headers);
      if (opts.sanitizeCredentials) {
        headers.set(INTERNAL_PURPOSE_HEADER, CORPUS_PURPOSE);
      }
      headers.set('cache-control', 'no-store');
      const cacheInit = supportsRequestCacheOption()
        ? /** @type {const} */ ({ cache: 'no-store' })
        : {};
      const rewriteTarget = new Request(targetUrl, {
        method: 'GET',
        headers,
        ...cacheInit,
      });
      const corpus = Boolean(opts.sanitizeCredentials);
      const collect = opts.collect !== false;
      const state = disposableCorpusStateFor(context);
      const directOuterCookies = !corpus ? state?.cookies : null;

      if (corpus) {
        // Never run an anonymous corpus render through a shared RenderContext.
        // Astro 5 and Astro 6.0-6.2 do not expose the closure-held caller IP,
        // cookies, or session for safe replacement. The public artifact handler
        // fails closed before reaching this defense-in-depth guard.
        return state ? renderFreshCorpusState(state, rewriteTarget, collect) : null;
      }

      const legacyPipeline = legacyPipelineFor(context);
      const restoreRewriteState = await prepareRewriteState(
        context,
        outerLocals,
        Boolean(legacyPipeline && !state),
      );
      let response;
      let restored = false;
      let cleanupInternal = () => {};
      const restore = () => {
        if (restored) return;
        restored = true;
        cleanupInternal();
        restoreRewriteState();
      };
      try {
        const rewriteLocals = context.locals;
        const previous = INTERNAL_REWRITES.get(rewriteLocals);
        INTERNAL_REWRITES.set(rewriteLocals, { collect, corpus });
        cleanupInternal = () => {
          if (previous) INTERNAL_REWRITES.set(rewriteLocals, previous);
          else INTERNAL_REWRITES.delete(rewriteLocals);
        };
        if (legacyPipeline && !state) {
          response = await withCollectionFlag(context, collect, async () => {
            const source = await next(rewriteTarget);
            return isolateInternalResponse(source, rewriteTarget, collect);
          });
        } else {
          response = await context.rewrite(rewriteTarget);
          if (
            directOuterCookies &&
            directOuterCookies !== state.cookies &&
            typeof directOuterCookies.merge === 'function'
          ) {
            directOuterCookies.merge(state.cookies);
          }
        }

        const transformable = isTransformableInternalResponse(response, rewriteTarget);
        if (transformable) {
          const html = await response.text();
          restore();
          return { response, html };
        }
        if (!collect && response.body && !responseBodyForbidden(rewriteTarget, response.status)) {
          const forwarded = restoreAfterBody(response, restore);
          return { response: forwarded, html: null };
        }
        cancelResponseBody(response);
        const settled = bodylessResponse(response);
        restore();
        return { response: settled, html: null };
      } catch {
        cancelResponseBody(response);
        restore();
        return null;
      }
    } catch { return null; }
  };

  return (pathname) => {
    const result = tail.then(() => loadOne(pathname));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

/**
 * Astro 6.3 and newer expose their request state on the API context. Corpus
 * renders use a disposable instance so private provider, locale, route, and
 * rewrite-counter caches cannot carry caller or page-to-page state.
 * @param {any} outerState
 * @param {Request} request
 * @param {boolean} collect
 * @returns {Promise<Awaited<ReturnType<import('./serve.js').HtmlFetcher>>>}
 */
async function renderFreshCorpusState(outerState, request, collect) {
  const pipeline = outerState.pipeline;
  if (!pipeline || typeof outerState.constructor !== 'function') return null;
  const renderOptions = {
    addCookieHeader: false,
    clientAddress: undefined,
    locals: {},
    prerenderedErrorPageFetch: outerState.renderOptions?.prerenderedErrorPageFetch,
    routeData: undefined,
    waitUntil: outerState.renderOptions?.waitUntil,
  };
  let state;
  try {
    state = new outerState.constructor(pipeline, request, renderOptions);
    await provideFreshSession(outerState, state);
    await provideFreshCache(outerState, state);
  } catch {
    return null;
  }

  const previous = INTERNAL_REWRITES.get(state.locals);
  INTERNAL_REWRITES.set(state.locals, { collect, corpus: true });
  let response;
  try {
    response = await state.rewrite(request);
  } catch {
    return null;
  } finally {
    if (previous) INTERNAL_REWRITES.set(state.locals, previous);
    else INTERNAL_REWRITES.delete(state.locals);
  }

  const transformable = isTransformableInternalResponse(response, request);
  if (transformable) {
    try {
      return { response, html: await response.text() };
    } catch {
      cancelResponseBody(response);
      return null;
    }
  }
  cancelResponseBody(response);
  return { response: bodylessResponse(response), html: null };
}

/** @param {any} outerState @param {any} freshState */
async function provideFreshCache(outerState, freshState) {
  if (typeof outerState.resolve !== 'function' || typeof freshState.provide !== 'function') return;
  const outerCache = outerState.resolve('cache');
  const Cache = outerCache?.constructor;
  if (typeof Cache !== 'function') return;
  const provider = outerCache.enabled
    ? await outerState.pipeline.getCacheProvider?.()
    : outerState.pipeline.logger;
  freshState.provide('cache', { create: () => new Cache(provider) });
}

/**
 * Register a fresh anonymous built-in session when the outer request has one.
 * Resolving the outer provider before constructing the disposable state keeps
 * Astro's cached outer session bound to the caller's own cookie jar.
 * @param {any} outerState
 * @param {any} freshState
 */
async function provideFreshSession(outerState, freshState) {
  const config = outerState.pipeline?.manifest?.sessionConfig;
  if (!config) return;
  if (typeof outerState.resolve !== 'function' || typeof freshState.provide !== 'function') {
    throw new Error('Astro session isolation is unavailable');
  }
  const outerSession = outerState.resolve('session');
  const Session = outerSession?.constructor;
  const driverFactory = await outerState.pipeline.getSessionDriver?.();
  if (typeof Session !== 'function' || !driverFactory) {
    throw new Error('Astro session isolation is unavailable');
  }
  freshState.provide('session', {
    create: () => new Session({
      cookies: freshState.cookies,
      config,
      runtimeMode: outerState.pipeline.runtimeMode,
      driverFactory,
      mockStorage: null,
    }),
  });
}

/**
 * Snapshot an object by descriptor so a direct rewrite can restore the public
 * request context after preserving the application's authentication state.
 * @param {object} locals
 * @returns {Map<PropertyKey, PropertyDescriptor>}
 */
function snapshotLocals(locals) {
  const snapshot = new Map();
  for (const key of Reflect.ownKeys(locals)) {
    const descriptor = Object.getOwnPropertyDescriptor(locals, key);
    if (!descriptor) continue;
    snapshot.set(key, descriptor);
  }
  return snapshot;
}

/** @param {object} locals @param {Map<PropertyKey, PropertyDescriptor>} snapshot */
function restoreLocals(locals, snapshot) {
  for (const key of Reflect.ownKeys(locals)) {
    if (snapshot.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(locals, key);
    if (descriptor?.configurable !== false) {
      try { delete locals[key]; } catch {}
    }
  }
  for (const [key, descriptor] of snapshot) {
    try { Object.defineProperty(locals, key, descriptor); } catch {}
  }
}

/**
 * Direct Astro rewrites mutate request state, including their loop counter and
 * route. Snapshot public state so the outer request can finish normally. Corpus
 * renders never use this path: they require a disposable FetchState.
 * @param {import('astro').APIContext} context
 * @param {Map<PropertyKey, PropertyDescriptor>} outerLocals
 * @param {boolean} legacyNext
 * @returns {Promise<() => void>}
 */
async function prepareRewriteState(
  context,
  outerLocals,
  legacyNext,
) {
  const state = /** @type {any} */ (context)[ASTRO_FETCH_STATE];
  const stateSnapshot = state ? snapshotLocals(state) : null;
  const contextSnapshot = legacyNext ? snapshotLocals(context) : null;
  return () => {
    if (state && stateSnapshot) restoreLocals(state, stateSnapshot);
    else restoreLocals(context.locals, outerLocals);
    if (contextSnapshot) restoreLocals(context, contextSnapshot);
  };
}

/**
 * Astro 5 and Astro 6.0-6.2 expose the pipeline through different symbols.
 * Astro 6.3 moved to FetchState, which is handled before this compatibility
 * path even though its API context may still retain `astro.pipeline`.
 * @param {import('astro').APIContext} context
 * @returns {any}
 */
function legacyPipelineFor(context) {
  return /** @type {any} */ (context)[ASTRO_5_PIPELINE] ??
    /** @type {any} */ (context)[ASTRO_6_LEGACY_PIPELINE];
}

/**
 * Astro 6.3 and newer expose a constructible FetchState. It is the first Astro
 * API that lets a corpus page replace caller-bound private state, including the
 * client address, rather than merely shadowing public APIContext properties.
 * @param {import('astro').APIContext} context
 * @returns {any | null}
 */
function disposableCorpusStateFor(context) {
  const state = /** @type {any} */ (context)[ASTRO_FETCH_STATE];
  return state?.pipeline &&
    typeof state.constructor === 'function' &&
    typeof state.constructor.prototype?.rewrite === 'function'
    ? state
    : null;
}

/** @param {Headers} headers */
function sanitizeSourceHeaders(headers) {
  for (const name of [
    'accept',
    'accept-charset',
    'accept-encoding',
    'accept-language',
    'connection',
    'content-length',
    'content-range',
    'host',
    'if-match',
    'if-modified-since',
    'if-none-match',
    'if-range',
    'if-unmodified-since',
    'range',
    'transfer-encoding',
    INTERNAL_REQUEST_HEADER,
    INTERNAL_PURPOSE_HEADER,
  ]) {
    headers.delete(name);
  }
  headers.set('accept', 'text/html, application/xhtml+xml');
  headers.set('accept-encoding', 'identity');
}

let supportsRequestCache;

/**
 * Workerd rejects the standard Request `cache` initializer. The no-store request
 * header remains authoritative there; other runtimes also receive the Fetch mode.
 * @returns {boolean}
 */
function supportsRequestCacheOption() {
  if (supportsRequestCache !== undefined) return supportsRequestCache;
  try {
    supportsRequestCache =
      new Request('https://astro-aeo.invalid/', { cache: 'no-store' }).cache === 'no-store';
  } catch {
    supportsRequestCache = false;
  }
  return supportsRequestCache;
}

/**
 * @param {string} pathname
 * @returns {string}
 */
function withTrailingSlash(pathname) {
  if (pathname === '/') return '/';
  return RUNTIME.site.trailingSlash === 'never' ? pathname : `${pathname}/`;
}

/**
 * @param {string | null} pagePath
 * @param {import('astro').APIContext} context
 * @returns {Record<string, string>}
 */
function canonicalLink(pagePath, context) {
  if (pagePath === null) return {};
  const origin = RUNTIME.site.siteUrl || context.url.origin;
  return { link: `<${origin}${basePrefix(RUNTIME.site.base)}${withTrailingSlash(pagePath)}>; rel="canonical"` };
}

/**
 * @param {Response | null | undefined} source
 * @param {string | null} pagePath
 * @param {import('astro').APIContext} context
 * @param {boolean} negotiated
 * @returns {Headers}
 */
function representationHeaders(source, pagePath, context, negotiated) {
  const headers = inheritedRepresentationHeaders(source ?? undefined);
  stripInternalHeaders(headers);
  const generatedLink = canonicalLink(pagePath, context).link;
  const existingLink = source?.headers.get('link');
  if (existingLink && /\brel\s*=\s*["']?canonical\b/i.test(existingLink)) {
    headers.set('link', existingLink);
  } else if (existingLink && generatedLink) {
    headers.set('link', `${existingLink}, ${generatedLink}`);
  } else if (generatedLink) {
    headers.set('link', generatedLink);
  }
  const vary = source?.headers.get('vary');
  if (negotiated) headers.set('vary', mergeCommaHeader(vary, 'Accept'));
  return headers;
}

/** @param {string | null} existing @param {string} value @returns {string} */
function mergeCommaHeader(existing, value) {
  const values = (existing ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (values.includes('*')) return '*';
  if (!values.some((part) => part.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(', ');
}

/**
 * @param {Response} source
 * @param {{ request: Request; origin: string; search: string }} original
 * @param {string} sourcePagePath
 * @returns {Response}
 */
function forwardSourceResponse(source, original, sourcePagePath) {
  const headers = new Headers(source.headers);
  stripInternalHeaders(headers);
  const location = headers.get('location');
  if (location && source.status >= 300 && source.status < 400) {
    try {
      const sourceUrl = new URL(
        `${basePrefix(RUNTIME.site.base)}${withTrailingSlash(sourcePagePath)}${original.search}`,
        original.origin,
      );
      const target = new URL(location, sourceUrl);
      if (target.origin === original.origin) {
        const decoded = decodePathname(target.pathname);
        if (decoded !== null) {
          const prefix = basePrefix(RUNTIME.site.base);
          const insideBase = !prefix || decoded === prefix || decoded.startsWith(`${prefix}/`);
          if (insideBase) {
            const pagePath = normalizePath(stripBase(decoded, RUNTIME.site.base));
            const encoded = encodeURI(pagePath);
            if (pagePathForMdPath(pagePath) === null) {
              target.pathname = `${prefix}${mdPathnameFor(normalizePath(encoded))}`;
            }
            headers.set('location', `${target.pathname}${target.search}${target.hash}`);
          }
        }
      }
    } catch {}
  }
  const bodyForbidden = responseBodyForbidden(original.request, source.status);
  if (bodyForbidden) cancelResponseBody(source);
  return new Response(bodyForbidden ? null : source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * Marker-bearing corpus source responses are internal implementation details.
 * Keep them out of shared caches even when the application response was cacheable.
 * @param {Response} response
 * @param {Request} request
 * @returns {Response}
 */
async function isolateCorpusResponse(response, request) {
  const headers = new Headers(response.headers);
  stripInternalHeaders(headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('vary', mergeCommaHeader(headers.get('vary'), INTERNAL_PURPOSE_HEADER));
  const body = isTransformableInternalResponse(response, request)
    ? await bufferedInternalBody(response, request)
    : null;
  if (body === null) cancelResponseBody(response);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Remove the private request channel from the response without changing its
 * representation or cache policy.
 * @param {Response} response
 * @param {Request} request
 * @param {boolean} collect
 * @returns {Response}
 */
async function isolateInternalResponse(response, request, collect) {
  const headers = new Headers(response.headers);
  stripInternalHeaders(headers);
  const transformable = isTransformableInternalResponse(response, request);
  const body = transformable
    ? await bufferedInternalBody(response, request)
    : collect
      ? null
      : responseBodyForbidden(request, response.status)
        ? null
        : response.body;
  if ((!transformable && collect) || responseBodyForbidden(request, response.status)) {
    cancelResponseBody(response);
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Consume lazy application streams while collection and corpus isolation are
 * still active. The reconstructed response preserves the exact bytes.
 * @param {Response} response
 * @param {Request} request
 * @returns {Promise<ArrayBuffer | null>}
 */
async function bufferedInternalBody(response, request) {
  if (responseBodyForbidden(request, response.status) || !response.body) return null;
  return response.arrayBuffer();
}

/** @param {Response} response @param {Request} request @returns {boolean} */
function isTransformableInternalResponse(response, request) {
  return !responseBodyForbidden(request, response.status) &&
    isUtf8HtmlResponse(response) &&
    isIdentityEncoded(response) &&
    response.status !== 206 &&
    !(response.status >= 300 && response.status < 400);
}

/** @param {Response} response @returns {Response} */
function bodylessResponse(response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Keep a rewritten request state alive for an opaque streaming response. The
 * state is restored exactly once when the consumer closes or cancels the body.
 * @param {Response} response
 * @param {() => void} restore
 * @returns {Response}
 */
function restoreAfterBody(response, restore) {
  if (!response.body) {
    restore();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    restore();
  };
  const body = new ReadableStream({
    async pull(controller) {
      let settled = false;
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          settled = true;
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        settled = true;
        try { controller.error(error); } catch {}
      } finally {
        if (settled) finish();
      }
    },
    cancel(reason) {
      try { void reader.cancel(reason).catch(() => {}); }
      finally { finish(); }
    },
  });
  try {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    finish();
    throw error;
  }
}

/** @param {Headers} headers @returns {Headers} */
function stripInternalHeaders(headers) {
  headers.delete(INTERNAL_REQUEST_HEADER);
  headers.delete(INTERNAL_PURPOSE_HEADER);
  return headers;
}

/**
 * @param {string} pathname
 * @returns {string | null} null when the path is not decodable.
 */
function decodePathname(pathname) {
  return inspectRootPathname(pathname)?.decoded ?? null;
}
