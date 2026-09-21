// @ts-check
import aeo from './index.js';

const OPTIONS_MODULE = 'virtual:astro-aeo/starlight-options';
const RESOLVED_OPTIONS_MODULE = `\0${OPTIONS_MODULE}`;

/**
 * Starlight plugin. It registers the Astro-AEO integration itself, so a project
 * lists `starlightAeo()` under Starlight's `plugins` and does not add `aeo()`.
 * Only Starlight's public plugin and route-data APIs are used.
 *
 * @param {import('./starlight.js').StarlightAeoOptions} [options]
 * @returns {import('./starlight.js').StarlightAeoPlugin}
 */
export default function starlightAeo(options = {}) {
  const runtime = {
    links: { pagination: options.links?.pagination !== false, edit: options.links?.edit === true },
    techArticle: options.techArticle !== false,
  };
  return {
    name: 'astro-aeo/starlight',
    hooks: {
      'config:setup'({ addIntegration, addRouteMiddleware, astroConfig }) {
        const integrations = /** @type {any[]} */ (astroConfig.integrations ?? []).flat(Infinity);
        if (integrations.some((integration) => integration?.name === 'astro-aeo')) {
          throw new Error(
            'astro-aeo: starlightAeo() registers the Astro-AEO integration itself. ' +
            'Remove aeo() from `integrations` and pass its options as starlightAeo({ aeo: { ... } }).',
          );
        }
        addIntegration(aeo(starlightDefaults(options.aeo)));
        addIntegration({
          name: 'astro-aeo/starlight-options',
          hooks: {
            'astro:config:setup'({ updateConfig }) {
              updateConfig({
                vite: {
                  plugins: [{
                    name: 'astro-aeo:starlight-options',
                    resolveId: (/** @type {string} */ id) => (id === OPTIONS_MODULE ? RESOLVED_OPTIONS_MODULE : undefined),
                    load: (/** @type {string} */ id) =>
                      id === RESOLVED_OPTIONS_MODULE ? `export default ${JSON.stringify(runtime)};` : undefined,
                  }],
                },
              });
            },
          },
        });
        addRouteMiddleware({ entrypoint: 'astro-aeo/starlight/route-data', order: 'post' });
      },
    },
  };
}

/**
 * Starlight registers `@astrojs/sitemap` itself, renders content inside
 * `.sl-markdown-content`, and always emits a 404 page. The sitemap and selector
 * defaults yield to anything the project sets; the 404 exclusion is added to the
 * project's own list.
 *
 * @param {import('./index.js').AstroAeoConfig | undefined} config
 * @returns {import('./index.js').AstroAeoConfig}
 */
export function starlightDefaults(config = {}) {
  const input = /** @type {any} */ (config);
  const legacySitemap = input.sitemap !== undefined;
  return {
    ...input,
    // Starlight always renders a 404 page. It is not documentation.
    ...(input.exclude === undefined
      ? { pages: { ...input.pages, exclude: [...(input.pages?.exclude ?? []), '/404'] } }
      : {}),
    markdown: {
      ...input.markdown,
      extraction: {
        ...(input.markdown?.extraction?.selectors === undefined
          ? { selectors: ['.sl-markdown-content', 'main'] }
          : {}),
        ...input.markdown?.extraction,
      },
    },
    ...(legacySitemap
      ? {}
      : {
          discovery: {
            ...input.discovery,
            sitemap: { mode: 'external', ...input.discovery?.sitemap },
          },
        }),
  };
}
