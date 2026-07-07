// @ts-check
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.js';
import { onBuildDone } from './hooks/build-done.js';
import { createAeoMiddleware } from './hooks/server-setup.js';

/**
 * Answer Engine Optimization integration for Astro.
 *
 * @param {import('./index.js').AstroAeoConfig} [userConfig]
 * @returns {import('astro').AstroIntegration}
 */
export default function aeo(userConfig = {}) {
  /** @type {ReturnType<typeof resolveConfig>} */
  let config;
  let siteUrl = '';
  let base = '';
  /** @type {'always'|'never'|'ignore'} */
  let trailingSlash = 'ignore';
  /** @type {'directory'|'file'} */
  let buildFormat = 'directory';
  let projectRoot = '';
  /** @type {Map<string, string>} */
  const routeEntrypoints = new Map();

  return {
    name: 'astro-aeo',
    hooks: {
      'astro:config:done': ({ config: astroConfig, logger }) => {
        config = resolveConfig(userConfig, logger);
        siteUrl = astroConfig.site ? astroConfig.site.toString().replace(/\/$/, '') : '';
        base = astroConfig.base && astroConfig.base !== '/' ? astroConfig.base : '';
        trailingSlash = astroConfig.trailingSlash ?? 'ignore';
        buildFormat = astroConfig.build?.format === 'file' ? 'file' : 'directory';
        projectRoot = fileURLToPath(astroConfig.root);
      },

      'astro:routes:resolved': ({ routes }) => {
        routeEntrypoints.clear();
        for (const route of routes) {
          // Only static (non-parameterized) routes have a concrete pathname we
          // can map back to a source file for git last-modified.
          const pathname = /** @type {string | undefined} */ (route.pathname);
          const entrypoint = /** @type {string | undefined} */ (route.entrypoint);
          if (pathname && entrypoint) {
            routeEntrypoints.set(normalize(pathname), entrypoint);
          }
        }
      },

      'astro:server:setup': ({ server, logger }) => {
        config = config ?? resolveConfig(userConfig, logger);
        server.middlewares.use(
          createAeoMiddleware({
            config,
            siteUrl,
            base,
            trailingSlash,
            getStaticPaths: () => [...routeEntrypoints.keys()],
            logger,
          }),
        );
      },

      'astro:build:done': async (options) => {
        await onBuildDone(config, /** @type {any} */ (options), {
          siteUrl,
          base,
          trailingSlash,
          buildFormat,
          projectRoot,
          routeEntrypoints,
        });
      },
    },
  };
}

/**
 * @param {string} p
 * @returns {string}
 */
function normalize(p) {
  let s = p.startsWith('/') ? p : `/${p}`;
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s;
}
