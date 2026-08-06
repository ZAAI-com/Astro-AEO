// @ts-check
import { RUNTIME, RUNTIME_CATALOG_LOADERS } from './config.js';
import { mdPathnameFor, pagePathForMdPath, basePrefix } from '../core/page-model.js';
import { isIncluded, normalizeCatalogPathname, normalizePath } from '../core/match.js';
import { extractPageMeta } from '../core/page-meta.js';
import { COLLECT_FLAG, stripMarkersFromHtml } from '../core/extract/marker.js';
import { withMarkdownAlternateLink } from '../core/alternate-link.js';
import { prefersMarkdown } from './negotiate.js';
import {
  MARKDOWN_CONTENT_TYPE,
  inheritedRepresentationHeaders,
  isNullBodyStatus,
  responseBodyForbidden,
  textResponse,
} from './respond.js';
import {
  artifactFor,
  renderStandaloneArtifact,
  RuntimeCorpusLimitError,
  serveLlmsIndex,
  serveMarkdown,
  stripBase,
} from './serve.js';

const DEV_NOTE =
  '<!-- astro-aeo dev preview: dynamic routes are omitted; run `astro build` for the full file -->';
const INTERNAL_REQUEST_HEADER = 'x-astro-aeo-internal';
const INTERNAL_PURPOSE_HEADER = 'x-astro-aeo-internal-purpose';
const CORPUS_PURPOSE = 'corpus';

/**
 * @param {import('astro').APIContext} context
 * @param {import('astro').MiddlewareNext} next
 * @returns {Promise<Response>}
 */
export const onRequest = async (context, next) => {
  if (RUNTIME.command === 'build' && context.isPrerendered) {
    markCollecting(context);
    return next();
  }

  if (
    RUNTIME.internalRequestToken &&
    context.request.headers.get(INTERNAL_REQUEST_HEADER) === RUNTIME.internalRequestToken
  ) {
    markCollecting(context);
    const response = await next();
    return context.request.headers.get(INTERNAL_PURPOSE_HEADER) === CORPUS_PURPOSE
      ? isolateCorpusResponse(response, context.request)
      : response;
  }

  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') return next();

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

  const projectOwned = ownedByProject(pathname);
  const artifact = projectOwned ? null : artifactFor(pathname, RUNTIME.config);
  if (artifact === 'robots' || artifact === 'domain-profile') {
    const { body, contentType } = renderStandaloneArtifact(artifact, RUNTIME, {
      sitemapAvailable: RUNTIME.sitemapAvailable,
      origin: context.url.origin,
    });
    return textResponse({ body, contentType, request: context.request });
  }
  if (artifact === 'llms' || artifact === 'llms-full') {
    try {
      const body = await serveLlmsIndex(artifact, RUNTIME, htmlFetcher(context, { sanitizeCredentials: true }), {
        note: RUNTIME.command === 'dev' ? DEV_NOTE : undefined,
        catalogLoaders: RUNTIME_CATALOG_LOADERS,
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
  if (RUNTIME.config.markdown.enabled && mdPagePath !== null && !projectOwned) {
    const fetcher = htmlFetcher(context, { preserveQuery: true });
    const { body, source } = await serveMarkdown(pathname, RUNTIME, fetcher, {
      catalogLoaders: RUNTIME_CATALOG_LOADERS,
      origin: context.url.origin,
    });
    if (body === null) {
      if (
        source &&
        (isNullBodyStatus(source.status) ||
          !isHtml(source) ||
          (source.status >= 300 && source.status < 400))
      ) {
        return forwardSourceResponse(source, context, mdPagePath);
      }
      return new Response(null, { status: source && !source.ok ? source.status : 404 });
    }
    return textResponse({
      body,
      contentType: MARKDOWN_CONTENT_TYPE,
      request: context.request,
      status: source?.status ?? 200,
      headers: representationHeaders(source, mdPagePath, context, false),
    });
  }

  const negotiation = RUNTIME.config.markdown.negotiation;
  if (!RUNTIME.config.markdown.enabled) return next();
  if (negotiation === 'off' && RUNTIME.config.markdown.alternateLink === 'never') return next();
  const wantsMarkdown =
    negotiation !== 'off' && prefersMarkdown(context.request.headers.get('accept'));
  if (wantsMarkdown) markCollecting(context);
  const response = await next();
  if (isNullBodyStatus(response.status)) return response;
  if (!isHtml(response)) return response;
  if (!response.ok) {
    return wantsMarkdown ? stripMarkerResponse(response, context.request) : response;
  }

  const html = await response.text();
  const cleanHtml = stripMarkersFromHtml(html);
  const pagePath = normalizePath(pathname);
  const eligible = isMarkdownEligible(pagePath, cleanHtml);
  const vary = negotiation !== 'off';

  if (wantsMarkdown && eligible && negotiation === 'redirect') {
    const headers = representationHeaders(response, pagePath, context, true);
    headers.set(
      'location',
      `${basePrefix(RUNTIME.site.base)}${mdPathnameFor(pagePath)}${context.url.search}`,
    );
    return new Response(null, {
      status: 303,
      headers,
    });
  }

  if (wantsMarkdown && eligible) {
    const { body } = await serveMarkdown(
      mdPathnameFor(pagePath),
      RUNTIME,
      async () => ({ html, response }),
      {
        catalogLoaders: RUNTIME_CATALOG_LOADERS,
        origin: context.url.origin,
      },
    );
    if (body !== null) {
      return textResponse({
        body,
        contentType: MARKDOWN_CONTENT_TYPE,
        request: context.request,
        status: response.status,
        headers: representationHeaders(response, pagePath, context, true),
      });
    }
  }

  const mode = RUNTIME.config.markdown.alternateLink;
  const href = `${basePrefix(RUNTIME.site.base)}${mdPathnameFor(pagePath)}`;
  const output = eligible && mode !== 'never'
    ? withMarkdownAlternateLink(cleanHtml, href, mode)
    : cleanHtml;
  return htmlResponse(output, response, context.request, {
    vary,
    changed: output !== html,
  });
};

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

/**
 * @param {string} html
 * @param {Response} source
 * @param {Request} request
 * @param {{ vary: boolean; changed: boolean }} options
 */
function htmlResponse(html, source, request, options) {
  const headers = new Headers(source.headers);
  if (options.vary) headers.set('vary', mergeCommaHeader(headers.get('vary'), 'Accept'));
  if (options.changed) {
    for (const name of ['content-length', 'content-encoding', 'content-range', 'accept-ranges', 'etag']) {
      headers.delete(name);
    }
  }
  return new Response(responseBodyForbidden(request, source.status) ? null : html, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/** @param {import('astro').APIContext} context @returns {void} */
function markCollecting(context) {
  /** @type {Record<string, unknown>} */ (context.locals)[COLLECT_FLAG] = true;
}

/** @param {string} pathname @returns {boolean} */
function ownedByProject(pathname) {
  if ((RUNTIME.projectPaths ?? RUNTIME.staticPaths).includes(pathname)) return true;
  return RUNTIME.projectPatterns?.some((pattern) => pattern.test(pathname)) ?? false;
}

/**
 * @param {import('astro').APIContext} context
 * @param {{ preserveQuery?: boolean; sanitizeCredentials?: boolean }} [opts]
 * @returns {import('./serve.js').HtmlFetcher}
 */
function htmlFetcher(context, opts = {}) {
  let rewritten = false;

  /** @param {string} pathname */
  const load = async (pathname) => {
    const target = `${basePrefix(RUNTIME.site.base)}${withTrailingSlash(pathname)}${opts.preserveQuery ? context.url.search : ''}`;
    try {
      const targetUrl = new URL(target, context.url.origin);
      if (targetUrl.origin !== context.url.origin) return null;
      const headers = opts.sanitizeCredentials
        ? new Headers()
        : new Headers(context.request.headers);
      headers.set(INTERNAL_REQUEST_HEADER, RUNTIME.internalRequestToken);
      if (opts.sanitizeCredentials) {
        headers.set(INTERNAL_PURPOSE_HEADER, CORPUS_PURPOSE);
        headers.set('cache-control', 'no-store');
      }
      const cacheInit = opts.sanitizeCredentials && supportsRequestCacheOption()
        ? /** @type {const} */ ({ cache: 'no-store' })
        : {};
      const rewriteTarget = new Request(targetUrl, {
        method: context.request.method,
        headers,
        ...cacheInit,
      });
      const response = rewritten
        ? await fetch(targetUrl, {
            headers,
            ...cacheInit,
            redirect: 'manual',
          })
        : ((rewritten = true), markCollecting(context), await context.rewrite(rewriteTarget));
      return { response, html: isHtml(response) ? await response.text() : null };
    } catch { return null; }
  };
  return load;
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
  if (!values.some((part) => part.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(', ');
}

/**
 * @param {Response} source
 * @param {import('astro').APIContext} context
 * @param {string} sourcePagePath
 * @returns {Response}
 */
function forwardSourceResponse(source, context, sourcePagePath) {
  const headers = new Headers(source.headers);
  const location = headers.get('location');
  if (location && source.status >= 300 && source.status < 400) {
    try {
      const sourceUrl = new URL(
        `${basePrefix(RUNTIME.site.base)}${withTrailingSlash(sourcePagePath)}${context.url.search}`,
        context.url.origin,
      );
      const target = new URL(location, sourceUrl);
      if (target.origin === context.url.origin) {
        const decoded = decodePathname(target.pathname);
        if (decoded !== null) {
          const prefix = basePrefix(RUNTIME.site.base);
          const insideBase = !prefix || decoded === prefix || decoded.startsWith(`${prefix}/`);
          if (insideBase) {
            const pagePath = normalizePath(stripBase(decoded, RUNTIME.site.base));
            if (pagePathForMdPath(pagePath) === null) {
              target.pathname = `${prefix}${mdPathnameFor(pagePath)}`;
            }
            headers.set('location', `${target.pathname}${target.search}${target.hash}`);
          }
        }
      }
    } catch {}
  }
  const bodyForbidden =
    responseBodyForbidden(context.request, source.status) ||
    (source.status >= 300 && source.status < 400);
  return new Response(bodyForbidden ? null : source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * @param {Response} response
 * @returns {boolean}
 */
function isHtml(response) {
  return (response.headers.get('content-type') ?? '').includes('html');
}

/**
 * Collection can make an authored source marker appear in an HTML error body.
 * Keep the application's response intact unless a marker actually needs removal.
 * @param {Response} response
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function stripMarkerResponse(response, request) {
  const html = await response.clone().text();
  const stripped = stripMarkersFromHtml(html);
  if (stripped === html) return response;
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'content-range', 'etag']) {
    headers.delete(name);
  }
  return new Response(responseBodyForbidden(request, response.status) ? null : stripped, {
    status: response.status,
    statusText: response.statusText,
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
function isolateCorpusResponse(response, request) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('vary', mergeCommaHeader(headers.get('vary'), INTERNAL_PURPOSE_HEADER));
  return new Response(responseBodyForbidden(request, response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * @param {string} pathname
 * @returns {string | null} null when the path is not decodable.
 */
function decodePathname(pathname) {
  if (normalizeCatalogPathname(pathname) === null) return null;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}
