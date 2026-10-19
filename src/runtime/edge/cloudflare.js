// @ts-check
import { observeEdge } from './observation.js';
import { createEdgeNegotiator } from './handler.js';

/**
 * Cloudflare. `onRequest` is a Pages Functions middleware (`functions/_middleware.js`);
 * `fetch` is a Worker with a static assets binding. Assets are read through the
 * binding, never over the network.
 *
 * @param {{ base?: string; assetsBinding?: string; analytics?: import('../../analytics.js').AnalyticsObserver }} [options]
 */
export function createCloudflareHandler(options = {}) {
  const binding = options.assetsBinding ?? 'ASSETS';
  /** @type {WeakMap<object, ReturnType<typeof createEdgeNegotiator>>} */
  const negotiators = new WeakMap();

  /** @param {any} env */
  function negotiatorFor(env) {
    const assets = env?.[binding];
    if (!assets || typeof assets.fetch !== 'function') return null;
    let negotiator = negotiators.get(assets);
    if (!negotiator) {
      negotiator = createEdgeNegotiator({
        base: options.base,
        fetchAsset: (pathname, request) => assets.fetch(new Request(new URL(pathname, request.url), { method: 'GET' })),
      });
      negotiators.set(assets, negotiator);
    }
    return negotiator;
  }

  return {
    /** @param {{ request: Request; env: any; next: () => Promise<Response>; waitUntil?: (work: Promise<void>) => void }} context */
    async onRequest(context) {
      const negotiator = negotiatorFor(context.env);
      const response = await (negotiator ? negotiator(context.request, () => context.next()) : context.next());
      return observeEdge(options.analytics, context.request, response, { surface: 'cloudflare', waitUntil: context.waitUntil?.bind(context) });
    },
    /** @param {Request} request @param {any} env @param {{ waitUntil?: (work: Promise<void>) => void }} [context] */
    async fetch(request, env, context) {
      const negotiator = negotiatorFor(env);
      const assets = env?.[binding];
      if (!negotiator) return observeEdge(options.analytics, request, new Response('astro-aeo: no static assets binding', { status: 500 }),
        { surface: 'cloudflare', waitUntil: context?.waitUntil?.bind(context) });
      return observeEdge(options.analytics, request, await negotiator(request, () => assets.fetch(request)),
        { surface: 'cloudflare', waitUntil: context?.waitUntil?.bind(context) });
    },
  };
}
