// @ts-check
import { observeEdge } from './observation.js';
import { EDGE_MANIFEST_PATHNAME, decideEdgeRepresentation, isEdgeSubrequest, isManifestMarkdown, readEdgeManifest } from './handler.js';

const INTERNAL_AGENT = 'astro-aeo-internal/1';

/**
 * Vercel Routing Middleware. Middleware cannot read the origin response, so the
 * decision is expressed with the `next` and `rewrite` helpers from
 * `@vercel/functions`, which the project's `middleware.js` imports and passes in.
 * The platform serves the rewritten `.md` asset, so its `ETag`, conditional
 * requests and `HEAD` handling are the platform's own.
 *
 * @param {{
 *   next: (init?: { headers?: Record<string, string> }) => Response;
 *   rewrite: (destination: string | URL, init?: { headers?: Record<string, string> }) => Response;
 *   analytics?: import('../../analytics.js').AnalyticsObserver;
 *   waitUntil?: (work: Promise<void>) => void;
 *   base?: string;
 *   fetch?: typeof globalThis.fetch;
 * }} options
 * @returns {(request: Request) => Promise<Response>}
 */
export function createVercelHandler(options) {
  if (typeof options?.next !== 'function' || typeof options.rewrite !== 'function') {
    throw new TypeError("astro-aeo: createVercelHandler() needs { next, rewrite } from '@vercel/functions'");
  }
  const base = (options.base ?? '').replace(/^\/+|\/+$/g, '');
  const manifestPathname = `${base ? `/${base}` : ''}${EDGE_MANIFEST_PATHNAME}`;
  /** @type {ReturnType<typeof readEdgeManifest>} */
  let cached = null;

  /** An anonymous HEAD for a static asset. Fetch is injected by the host and the
   * request never carries caller credentials.
   * @param {string} pathname @param {Request} request */
  async function assetOk(pathname, request) {
    try {
      const response = await (options.fetch ?? globalThis.fetch)(new URL(pathname, request.url), {
        method: 'HEAD', headers: { 'user-agent': INTERNAL_AGENT }, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(2000),
      });
      void response.body?.cancel().catch(() => {});
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /** @param {Request} request */
  async function middleware(request) {
    const direct = new URL(request.url).pathname.endsWith('.md');
    if ((request.method !== 'GET' && request.method !== 'HEAD') || (!direct && isEdgeSubrequest(request))) return options.next();
    if (!cached) {
      try {
        const response = await (options.fetch ?? globalThis.fetch)(new URL(manifestPathname, request.url), { headers: { 'user-agent': INTERNAL_AGENT } });
        cached = response.ok ? readEdgeManifest(await response.json()) : null;
      } catch {
        cached = null;
      }
    }
    if (direct) {
      // Middleware never sees the asset status, so verify it before a cache policy
      // could make a 404 or 5xx cacheable. Our own preflight passes straight through.
      if (cached?.cacheControl === undefined || request.headers.get('user-agent') === INTERNAL_AGENT ||
        !isManifestMarkdown(cached, new URL(request.url).pathname)) return options.next();
      return await assetOk(new URL(request.url).pathname, request)
        ? options.next({ headers: { 'cache-control': cached.cacheControl } }) : options.next();
    }
    const decision = decideEdgeRepresentation(request, cached);
    if (decision.kind === 'pass') return options.next();
    if (decision.kind === 'html') return options.next({ headers: { vary: 'Accept' } });
    // Verify the companion before a rewrite or redirect.
    const companion = decision.kind === 'markdown' ? decision.pathname : new URL(decision.location, request.url).pathname;
    if (!await assetOk(companion, request)) return options.next({ headers: { vary: 'Accept' } });
    if (decision.kind === 'redirect') {
      return new Response(null, { status: 303, headers: { location: decision.location, vary: 'Accept' } });
    }
    return options.rewrite(new URL(decision.pathname, request.url), {
      headers: { vary: 'Accept', 'content-type': 'text/markdown; charset=utf-8',
        ...(cached?.cacheControl === undefined ? {} : { 'cache-control': cached.cacheControl }) },
    });
  }
  return async (request) => observeEdge(options.analytics, request, await middleware(request),
    { surface: 'vercel', waitUntil: options.waitUntil });
}
