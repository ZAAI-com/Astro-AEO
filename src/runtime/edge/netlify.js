// @ts-check
import { observeEdge } from './observation.js';
import { createEdgeNegotiator } from './handler.js';

/**
 * Netlify Edge Function. Assets are read with `context.next(request)`, which
 * continues down the request chain for another path and never re-enters this
 * function.
 *
 * @typedef {{ next: (request?: Request) => Promise<Response>; waitUntil?: (work: Promise<void>) => void }} NetlifyContext
 * @param {{ base?: string; analytics?: import('../../analytics.js').AnalyticsObserver }} [options]
 * @returns {(request: Request, context: NetlifyContext) => Promise<Response>}
 */
export function createNetlifyHandler(options = {}) {
  const negotiate = createEdgeNegotiator({
    base: options.base,
    fetchAsset: (pathname, request, /** @type {NetlifyContext} */ context) =>
      context.next(new Request(new URL(pathname, request.url), { method: 'GET' })),
  });
  return async (request, context) => observeEdge(options.analytics, request, await negotiate(request, () => context.next(), context),
    { surface: 'netlify', waitUntil: context.waitUntil?.bind(context) });
}
