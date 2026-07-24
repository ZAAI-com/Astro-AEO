// @ts-check
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import { resolveConfig } from './config.js';
import { resolveSitemapPlan } from './lib/sitemap.js';
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
  // Whether a sitemap will exist in the build (user-registered or auto-added).
  // Resolved in astro:config:setup; gates the robots.txt Sitemap line.
  let sitemapActive = false;
  /** @type {Map<string, string>} */
  const routeEntrypoints = new Map();

  return {
    name: 'astro-aeo',
    hooks: {
      // Integrations can only be added here, so resolve config early and, when
      // the sitemap feature is on and none is present, auto-register the
      // official @astrojs/sitemap rather than emitting XML ourselves.
      'astro:config:setup': ({ config: astroConfig, updateConfig, logger }) => {
        config = resolveConfig(userConfig, logger);
        const hasUserSitemap = (astroConfig.integrations ?? []).some(
          (i) => i && i.name === '@astrojs/sitemap',
        );
        const plan = resolveSitemapPlan({
          enabled: config.sitemap.enabled,
          hasUserSitemap,
          hasSite: Boolean(astroConfig.site),
        });
        if (plan.warning) logger.warn(plan.warning);
        if (plan.register) {
          updateConfig({ integrations: [sitemap(/** @type {any} */ (config.sitemap.options))] });
        }
        sitemapActive = plan.active;
      },

      'astro:config:done': ({ config: astroConfig, logger }) => {
        // Reuse the config resolved in astro:config:setup so warnings fire once.
        config = config ?? resolveConfig(userConfig, logger);
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
            sitemapActive,
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
          sitemapActive,
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
