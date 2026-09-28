// @ts-check
import { createEdgeNegotiator } from './handler.js';

/**
 * Cloudflare. `onRequest` is a Pages Functions middleware (`functions/_middleware.js`);
 * `fetch` is a Worker with a static assets binding. Assets are read through the
 * binding, never over the network.
 *
 * @param {{ base?: string; assetsBinding?: string }} [options]
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
    /** @param {{ request: Request; env: any; next: () => Promise<Response> }} context */
    onRequest(context) {
      const negotiator = negotiatorFor(context.env);
      return negotiator ? negotiator(context.request, () => context.next()) : context.next();
    },
    /** @param {Request} request @param {any} env */
    fetch(request, env) {
      const negotiator = negotiatorFor(env);
      const assets = env?.[binding];
      if (!negotiator) return new Response('astro-aeo: no static assets binding', { status: 500 });
      return negotiator(request, () => assets.fetch(request));
    },
  };
}
