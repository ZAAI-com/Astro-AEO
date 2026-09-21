// @ts-check
import { createEdgeNegotiator } from './handler.js';

/**
 * Netlify Edge Function. Assets are read with `context.next(request)`, which
 * continues down the request chain for another path and never re-enters this
 * function.
 *
 * @typedef {{ next: (request?: Request) => Promise<Response> }} NetlifyContext
 * @param {{ base?: string }} [options]
 * @returns {(request: Request, context: NetlifyContext) => Promise<Response>}
 */
export function createNetlifyHandler(options = {}) {
  const negotiate = createEdgeNegotiator({
    base: options.base,
    fetchAsset: (pathname, request, /** @type {NetlifyContext} */ context) =>
      context.next(new Request(new URL(pathname, request.url), { method: 'GET' })),
  });
  return (request, context) => negotiate(request, () => context.next(), context);
}
