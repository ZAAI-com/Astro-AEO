// @ts-check
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import { resolveConfig } from './config.js';
import { resolveSitemapPlan } from './lib/sitemap.js';
import { emitSitemapAlias } from './generators/sitemap-alias.js';
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
        sitemapActive = plan.active;

        // Build the integrations to append in order. The sitemap alias must run
        // AFTER @astrojs/sitemap has written its index, and Astro runs
        // astro:build:done in integration-array order, so we append the alias
        // integration last (aeo's own build:done runs before either of these).
        const added = [];
        if (plan.register) {
          added.push(sitemap(/** @type {any} */ (config.sitemap.options)));
        }
        if (config.sitemapAlias.enabled && sitemapActive) {
          added.push(sitemapAliasIntegration(config));
        }
        if (added.length) updateConfig({ integrations: added });
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
 * A minimal integration whose only job is to mirror the generated sitemap index
 * to a conventional /sitemap.xml. It lives in its own integration, appended after
 * @astrojs/sitemap, because Astro runs astro:build:done in integration order and
 * the copy must happen after the sitemap file is written (aeo's own build:done
 * runs too early). Never throws; a missing/unwritable sitemap only warns.
 *
 * @param {ReturnType<typeof resolveConfig>} config
 * @returns {import('astro').AstroIntegration}
 */
function sitemapAliasIntegration(config) {
  return {
    name: 'astro-aeo/sitemap-alias',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if (emitSitemapAlias(dir, config, logger)) {
          logger.info(`astro-aeo: emitted /${config.sitemapAlias.outputFilename}`);
        }
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
