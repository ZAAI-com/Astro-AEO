// @ts-check
import { observeEdge } from './observation.js';
import { EDGE_MANIFEST_PATHNAME, decideEdgeRepresentation, isEdgeSubrequest, readEdgeManifest } from './handler.js';

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

  /** @param {Request} request */
  async function middleware(request) {
    const direct = new URL(request.url).pathname.endsWith('.md');
    if ((request.method !== 'GET' && request.method !== 'HEAD') || (!direct && isEdgeSubrequest(request))) return options.next();
    if (!cached) {
      try {
        const response = await (options.fetch ?? globalThis.fetch)(new URL(manifestPathname, request.url), { headers: { 'user-agent': 'astro-aeo-internal/1' } });
        cached = response.ok ? readEdgeManifest(await response.json()) : null;
      } catch {
        cached = null;
      }
    }
    if (direct) {
      return cached?.cacheControl !== undefined && [...cached.routes.values()].includes(new URL(request.url).pathname)
        ? options.next({ headers: { 'cache-control': cached.cacheControl } }) : options.next();
    }
    const decision = decideEdgeRepresentation(request, cached);
    if (decision.kind === 'pass') return options.next();
    if (decision.kind === 'html') return options.next({ headers: { vary: 'Accept' } });
    // Verify the companion before a rewrite or redirect. Fetch is injected by
    // the host and this anonymous HEAD never carries caller credentials.
    const companion = decision.kind === 'markdown' ? decision.pathname : new URL(decision.location, request.url).pathname;
    try {
      const response = await (options.fetch ?? globalThis.fetch)(new URL(companion, request.url), {
        method: 'HEAD', headers: { 'user-agent': 'astro-aeo-internal/1' }, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(2000),
      });
      void response.body?.cancel().catch(() => {});
      if (response.status !== 200) return options.next({ headers: { vary: 'Accept' } });
    } catch {
      return options.next({ headers: { vary: 'Accept' } });
    }
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
