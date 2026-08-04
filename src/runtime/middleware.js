// @ts-check
import { RUNTIME } from './config.js';
import { mdPathnameFor, pagePathForMdPath, basePrefix } from '../core/page-model.js';
import { normalizePath } from '../core/match.js';
import { COLLECT_FLAG, stripMarkersFromHtml } from '../core/extract/marker.js';
import { prefersMarkdown } from './negotiate.js';
import { MARKDOWN_CONTENT_TYPE, inheritedCacheHeaders, textResponse } from './respond.js';
import {
  artifactFor,
  renderStandaloneArtifact,
  serveLlmsIndex,
  serveMarkdown,
  stripBase,
} from './serve.js';

/**
 * The request-time half of astro-aeo.
 *
 * Registered with `addMiddleware({ order: 'pre' })`, so this is the outermost
 * handler and `next()` resolves to the fully rendered downstream response.
 *
 * Two behaviours rest on measured Astro facts rather than documentation, both
 * recorded in the agent guide: app middleware runs for a path that matches no
 * route, and a `Response` returned without calling `next()` arrives with its own
 * status even though the handler seeded 404 for the unmatched path.
 */

const DEV_NOTE =
  '<!-- astro-aeo dev preview: dynamic routes are omitted; run `astro build` for the full file -->';

/**
 * @param {import('astro').APIContext} context
 * @param {import('astro').MiddlewareNext} next
 * @returns {Promise<Response>}
 */
export const onRequest = async (context, next) => {
  // Hard gate. During `astro build` the prerender pass runs this middleware for
  // every page, and those responses become the HTML files on disk; converting one
  // would write Markdown into a .html file. Testing `isPrerendered` alone would be
  // wrong: in `astro dev` static routes report it true as well, which would
  // disable the dev server entirely.
  if (RUNTIME.command === 'build' && context.isPrerendered) {
    // This pass produces the HTML files the build then reads back, so the page
    // should include its source marker. `stripSourceMarkers` removes it from
    // every file afterwards, so nothing ships with it.
    markCollecting(context);
    return next();
  }

  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') return next();

  const decoded = decodePathname(context.url.pathname);
  if (decoded === null) return next();
  const pathname = stripBase(decoded, RUNTIME.site.base);

  // 1. Artifacts we own outright. In a build these exist as static files and the
  //    host serves them before the app runs, so in practice this is the dev path.
  const artifact = artifactFor(pathname, RUNTIME.config);
  if (artifact === 'robots' || artifact === 'domain-profile') {
    const { body, contentType } = renderStandaloneArtifact(artifact, RUNTIME);
    return textResponse({ body, contentType, request: context.request });
  }
  if (artifact === 'llms' || artifact === 'llms-full') {
    const body = await serveLlmsIndex(artifact, RUNTIME, htmlFetcher(context), {
      note: RUNTIME.command === 'dev' ? DEV_NOTE : undefined,
    });
    return textResponse({ body, contentType: 'text/plain; charset=utf-8', request: context.request });
  }

  // 2. A direct `.md` request.
  const mdPagePath = pagePathForMdPath(pathname);
  if (RUNTIME.config.markdown.enabled && mdPagePath !== null && !ownedByProject(pathname)) {
    const fetcher = htmlFetcher(context);
    const body = await serveMarkdown(pathname, RUNTIME, fetcher);
    // Not `next()`: after the chain has been entered, `next()` resolves to the
    // underlying page's HTML, so an excluded or `no-dotmd` page would be served in
    // full, with a 200, at its .md URL. Mirror the upstream status when there is
    // one, because the project's own middleware may have answered 401 or 403 and
    // replacing that with 404 would contradict the decision it just made.
    if (body === null) return new Response(null, { status: fetcher.upstreamStatus() ?? 404 });
    return textResponse({
      body,
      contentType: MARKDOWN_CONTENT_TYPE,
      request: context.request,
      headers: canonicalLink(mdPagePath, context),
    });
  }

  // 3. Accept negotiation on a route that does exist.
  const negotiation = RUNTIME.config.markdown.negotiation;
  if (negotiation === 'off' || !RUNTIME.config.markdown.enabled) return next();
  if (!prefersMarkdown(context.request.headers.get('accept'))) return next();

  if (negotiation === 'redirect') {
    return new Response(null, {
      status: 303,
      headers: { location: `${basePrefix(RUNTIME.site.base)}${mdPathnameFor(normalizePath(pathname))}`, vary: 'Accept' },
    });
  }

  const response = await next();
  if (!isHtml(response)) return response;
  // Only a successful page has a representation worth converting. An error page
  // keeps its own status and body rather than being turned into Markdown.
  if (!response.ok) return response;

  const html = await response.text();
  const body = await serveMarkdown(mdPathnameFor(normalizePath(pathname)), RUNTIME, async () => html);
  // Declined conversion: hand back the page, minus the internal marker.
  if (body === null) return new Response(stripMarkersFromHtml(html), response);

  return textResponse({
    body,
    contentType: MARKDOWN_CONTENT_TYPE,
    request: context.request,
    headers: { vary: 'Accept', ...canonicalLink(normalizePath(pathname), context), ...inheritedCacheHeaders(response) },
  });
};

/**
 * Tell `<AeoPage>` that this render is for astro-aeo, so it should emit its
 * source marker. Locals survive a rewrite, which is what makes this work.
 * @param {import('astro').APIContext} context
 * @returns {void}
 */
function markCollecting(context) {
  /** @type {Record<string, unknown>} */ (context.locals)[COLLECT_FLAG] = true;
}

/**
 * Whether the project defines this exact path as a route of its own.
 *
 * The same principle the build's artifact writer applies: a path the project
 * routes is the project's, so `/docs.md` as a real route is never intercepted.
 * @param {string} pathname
 * @returns {boolean}
 */
function ownedByProject(pathname) {
  return RUNTIME.staticPaths.includes(pathname);
}

/**
 * Render a page by rewriting into its real route.
 *
 * `next(path)` re-enters the routing chain, so the project's own middleware runs
 * and its authentication applies to a `.md` request exactly as it does to the
 * HTML. That is the reason for rewriting rather than fetching.
 *
 * Only one rewrite is possible per request, so the corpus index passes its own
 * fetcher for the pages after the first.
 *
 * @param {import('astro').APIContext} context
 * @returns {import('./serve.js').HtmlFetcher & { upstreamStatus(): number | null }}
 */
function htmlFetcher(context) {
  let rewritten = false;
  /** @type {number | null} */
  let upstream = null;

  /** @param {string} pathname */
  const load = async (pathname) => {
    const target = `${basePrefix(RUNTIME.site.base)}${withTrailingSlash(pathname)}`;
    try {
      const response = rewritten
        ? await fetch(new URL(target, context.url.origin), { headers: { 'x-astro-aeo': '1' } })
        : ((rewritten = true), markCollecting(context), await context.rewrite(target));
      if (!response.ok) {
        upstream = response.status;
        return null;
      }
      return isHtml(response) ? await response.text() : null;
    } catch {
      // A rewrite into a prerendered route throws in a server build. That page's
      // .md already exists as a build artifact, so there is nothing to do here.
      return null;
    }
  };
  return Object.assign(load, { upstreamStatus: () => upstream });
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
 * @param {Response} response
 * @returns {boolean}
 */
function isHtml(response) {
  return (response.headers.get('content-type') ?? '').includes('html');
}

/**
 * @param {string} pathname
 * @returns {string | null} null when the path is not decodable.
 */
function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}
