// @ts-check
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

  return async function middleware(request) {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isEdgeSubrequest(request)) return options.next();
    if (!cached) {
      try {
        const response = await (options.fetch ?? globalThis.fetch)(new URL(manifestPathname, request.url));
        cached = response.ok ? readEdgeManifest(await response.json()) : null;
      } catch {
        cached = null;
      }
    }
    const decision = decideEdgeRepresentation(request, cached);
    if (decision.kind === 'pass') return options.next();
    if (decision.kind === 'html') return options.next({ headers: { vary: 'Accept' } });
    if (decision.kind === 'redirect') {
      return new Response(null, { status: 303, headers: { location: decision.location, vary: 'Accept' } });
    }
    return options.rewrite(new URL(decision.pathname, request.url), {
      headers: { vary: 'Accept', 'content-type': 'text/markdown; charset=utf-8' },
    });
  };
}
