// @ts-check
import { assertExactPathname } from '../../core/artifact-path.js';
import { inspectRootPathname } from '../../core/match.js';
import { prefersMarkdown } from '../negotiate.js';
import { MARKDOWN_CONTENT_TYPE, isNotModified, responseBodyForbidden } from '../respond.js';

/**
 * Content negotiation for a fully static deployment, run by the host's edge
 * layer. It reads one build-time manifest and otherwise mirrors the Astro
 * middleware: GET and HEAD only, exact manifest routes only, Markdown only when
 * it strictly outranks HTML, and `Vary: Accept` on every eligible route whichever
 * representation is selected. Any doubt (a missing, malformed or stale manifest,
 * a missing companion) resolves to the unmodified HTML response.
 *
 * @typedef {{ kind: 'pass' } | { kind: 'html' } | { kind: 'redirect'; location: string } | { kind: 'markdown'; pathname: string }} EdgeDecision
 */

export const EDGE_MANIFEST_PATHNAME = '/.well-known/astro-aeo-edge-v1.json';
const MAX_ROUTES = 200_000;

/**
 * Validate an untrusted manifest and index its routes. Returns `null` for
 * anything unexpected: a manifest is all or nothing.
 *
 * @param {unknown} value
 * @returns {{ mode: 'response' | 'redirect'; routes: Map<string, string> } | null}
 */
export function readEdgeManifest(value) {
  const manifest = /** @type {any} */ (value);
  if (!manifest || typeof manifest !== 'object' || manifest.version !== 1) return null;
  if (manifest.mode !== 'response' && manifest.mode !== 'redirect') return null;
  if (!Array.isArray(manifest.routes) || manifest.routes.length > MAX_ROUTES) return null;
  /** @type {Map<string, string>} */
  const routes = new Map();
  for (const route of manifest.routes) {
    if (!route || typeof route.html !== 'string' || typeof route.markdown !== 'string') return null;
    if (inspectRootPathname(route.html) === null || !route.markdown.endsWith('.md')) return null;
    try {
      assertExactPathname(route.markdown, 'markdown');
    } catch {
      return null;
    }
    routes.set(routeKey(route.html), route.markdown);
  }
  return { mode: manifest.mode, routes };
}

/**
 * The representation decision for one request. Pure, so every host adapter and
 * the contract tests share it.
 *
 * @param {Request} request
 * @param {ReturnType<typeof readEdgeManifest>} manifest
 * @returns {EdgeDecision}
 */
export function decideEdgeRepresentation(request, manifest) {
  if (!manifest || (request.method !== 'GET' && request.method !== 'HEAD')) return { kind: 'pass' };
  const url = new URL(request.url);
  const markdown = manifest.routes.get(routeKey(url.pathname));
  if (markdown === undefined) return { kind: 'pass' };
  if (!prefersMarkdown(request.headers.get('accept'))) return { kind: 'html' };
  return manifest.mode === 'redirect'
    ? { kind: 'redirect', location: `${markdown}${url.search}` }
    : { kind: 'markdown', pathname: markdown };
}

/**
 * True for requests the handler must never inspect a manifest for: its own
 * manifest and companion subrequests, which would otherwise recurse on hosts
 * where an asset fetch passes back through the edge layer.
 *
 * @param {Request} request
 */
export function isEdgeSubrequest(request) {
  const pathname = new URL(request.url).pathname;
  return pathname.endsWith(EDGE_MANIFEST_PATHNAME) || pathname.endsWith('.md');
}

/**
 * A negotiator for hosts that can fetch a static asset and continue to the
 * origin response (Cloudflare, Netlify).
 *
 * `context` is whatever the host passes per request. It is handed back to
 * `fetchAsset` untouched, so an adapter never stores request state of its own.
 *
 * @template [C=undefined]
 * @param {{
 *   fetchAsset: (pathname: string, request: Request, context: C) => Promise<Response>;
 *   base?: string;
 * }} host
 * @returns {(request: Request, next: () => Promise<Response>, context?: C) => Promise<Response>}
 */
export function createEdgeNegotiator(host) {
  const manifestPathname = `${normalizeBase(host.base)}${EDGE_MANIFEST_PATHNAME}`;
  /** @type {ReturnType<typeof readEdgeManifest>} */
  let cached = null;

  /** @param {Request} request @param {C} context */
  async function manifestFor(request, context) {
    if (cached) return cached;
    try {
      const response = await host.fetchAsset(manifestPathname, request, context);
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      // Only a valid manifest is kept: a bad one is retried, so a deploy that fixes it takes effect.
      cached = readEdgeManifest(await response.json());
      return cached;
    } catch {
      return null;
    }
  }

  return async function negotiate(request, next, context) {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isEdgeSubrequest(request)) return next();
    const decision = decideEdgeRepresentation(request, await manifestFor(request, /** @type {C} */ (context)));
    if (decision.kind === 'pass') return next();
    if (decision.kind === 'redirect') {
      return new Response(null, { status: 303, headers: { location: decision.location, vary: 'Accept' } });
    }
    if (decision.kind === 'markdown') {
      const markdown = await markdownResponse(() => host.fetchAsset(decision.pathname, request, /** @type {C} */ (context)), request);
      if (markdown) return markdown;
    }
    return withVaryAccept(await next());
  };
}

/**
 * @param {() => Promise<Response>} fetchCompanion
 * @param {Request} request
 * @returns {Promise<Response | null>} `null` when the companion is not there: the manifest is stale.
 */
async function markdownResponse(fetchCompanion, request) {
  let asset;
  try {
    asset = await fetchCompanion();
  } catch {
    return null;
  }
  if (asset.status !== 200) {
    await asset.body?.cancel();
    return null;
  }
  const headers = new Headers();
  for (const name of ['etag', 'last-modified', 'cache-control']) {
    const value = asset.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('content-type', MARKDOWN_CONTENT_TYPE);
  headers.set('vary', 'Accept');
  const etag = headers.get('etag');
  if (etag && isNotModified(request, etag.replace(/^W\//, ''))) {
    await asset.body?.cancel();
    return new Response(null, { status: 304, headers });
  }
  if (responseBodyForbidden(request, 200)) {
    await asset.body?.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(asset.body, { status: 200, headers });
}

/** Merge `Accept` into `Vary` without touching the body or any other header. @param {Response} response */
export function withVaryAccept(response) {
  const current = response.headers.get('vary') ?? '';
  if (current.trim() === '*' || current.split(',').some((name) => name.trim().toLowerCase() === 'accept')) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('vary', current ? `${current}, Accept` : 'Accept');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** `/docs/` and `/docs` are the same static page. @param {string} pathname */
function routeKey(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // An undecodable path matches nothing in a manifest of valid paths.
  }
  return decoded.length > 1 && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
}

/** @param {string | undefined} base */
function normalizeBase(base) {
  const trimmed = (base ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}
