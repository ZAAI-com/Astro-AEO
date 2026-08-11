// @ts-check
import { enrichHtmlHead } from '../core/head.js';

/**
 * The semantic pipeline is registered through the same dispatcher exposed to
 * user plugins. Its graph-stage value is a serializable envelope so later
 * plugins can inspect or replace the managed graph without access to requests.
 *
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {import('../index.js').AstroAeoPlugin}
 */
export function createSemanticPlugin(config) {
  return {
    name: 'astro-aeo:semantic',
    apiVersion: 1,
    setup(api) {
      api.on('graph:build', ({ value }) => {
        const input = /** @type {{ html: string; page: import('../index.js').AeoPageRecord; site: {siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore'}; allowGlobal?: boolean; breadcrumbTrail?: ReadonlyArray<{name: string; item: string}> | null }} */ (value);
        const result = enrichHtmlHead({
          html: input.html,
          page: input.page,
          config,
          site: input.site,
          allowGlobal: input.allowGlobal,
          breadcrumbTrail: input.breadcrumbTrail,
        });
        return {
          action: 'replace',
          value: {
            html: result.html,
            page: result.page,
            site: input.site,
            graph: result.graph,
            normalizedGraph: result.normalizedGraph,
            explicit: result.explicit,
          },
          diagnostics: result.diagnostics.map(({ code, severity, message }) => ({ code, severity, message })),
        };
      });
    },
  };
}
