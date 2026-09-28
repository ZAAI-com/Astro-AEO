// @ts-check

export const EDGE_PROVIDERS = /** @type {const} */ (['cloudflare', 'netlify', 'vercel']);

/**
 * The build half of static edge negotiation. The returned plugin registers no
 * hook: it is a declaration that the integration recognizes by its
 * `astroAeoEdge` field and answers by emitting the edge manifest itself, as a
 * core artifact under normal ownership arbitration.
 *
 * @param {typeof EDGE_PROVIDERS[number]} provider
 * @returns {import('../index.js').AstroAeoPlugin & { astroAeoEdge: { provider: typeof EDGE_PROVIDERS[number] } }}
 */
export function createEdgePlugin(provider) {
  return {
    name: `astro-aeo-edge-${provider}`,
    apiVersion: 1,
    setup() {},
    astroAeoEdge: { provider },
  };
}

/**
 * @param {readonly unknown[]} plugins
 * @returns {typeof EDGE_PROVIDERS[number] | null}
 */
export function edgeProviderOf(plugins) {
  const providers = plugins.flatMap((plugin) => {
    const provider = /** @type {any} */ (plugin)?.astroAeoEdge?.provider;
    return provider === undefined ? [] : [provider];
  });
  if (providers.length === 0) return null;
  if (providers.length > 1) throw new TypeError('astro-aeo: configure at most one static edge provider.');
  if (!EDGE_PROVIDERS.includes(providers[0])) throw new TypeError('astro-aeo: unknown static edge provider.');
  return providers[0];
}
