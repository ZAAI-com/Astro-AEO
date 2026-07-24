// @ts-check
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import { resolveConfig } from './config.js';
import {
  resolveSitemapPlan,
  resolveSitemapPolicy,
  sitemapPathExists,
  sitemapPathMatchesRoute,
} from './lib/sitemap.js';
import { finalizeSitemapOutputs } from './generators/sitemap-finalize.js';
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
  /** @type {URL | undefined} */
  let publicDir;
  const sitemapPolicy = resolveSitemapPolicy(userConfig.robotsTxt?.includeSitemap);
  const sitemapState = {
    expected: false,
    siteUrl: '',
    base: '',
    sitemapPolicy,
  };
  /** @type {Map<string, string>} */
  const routeEntrypoints = new Map();
  /** @type {Set<string>} */
  const resolvedRoutePaths = new Set();

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
        sitemapState.expected = plan.expected;

        // Astro runs build:done hooks in integration-array order. Append the
        // finalizer after the official sitemap so it can verify real output,
        // create the alias, and only then write robots.txt.
        const added = [];
        if (plan.register) {
          added.push(sitemap(/** @type {any} */ (config.sitemap.options)));
        }
        if (config.sitemapAlias.enabled || config.robotsTxt.enabled) {
          added.push(sitemapFinalizerIntegration(config, sitemapState));
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
        publicDir = astroConfig.publicDir;
        sitemapState.siteUrl = siteUrl;
        sitemapState.base = base;
      },

      'astro:routes:resolved': ({ routes }) => {
        routeEntrypoints.clear();
        resolvedRoutePaths.clear();
        for (const route of routes) {
          // Only static (non-parameterized) routes have a concrete pathname we
          // can map back to a source file for git last-modified.
          const pathname = /** @type {string | undefined} */ (route.pathname);
          const entrypoint = /** @type {string | undefined} */ (route.entrypoint);
          if (pathname) resolvedRoutePaths.add(normalize(pathname));
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
            sitemapPolicy,
            isSitemapAvailable: () =>
              (publicDir ? sitemapPathExists(publicDir, config.robotsTxt.sitemapPath) : false) ||
              sitemapPathMatchesRoute(config.robotsTxt.sitemapPath, [...resolvedRoutePaths]),
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
 * A minimal integration appended after sitemap generation. It verifies the
 * expected index, creates the non-destructive alias, then writes robots.txt
 * according to the configured auto/always/never policy.
 *
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{ expected: boolean; siteUrl: string; base: string; sitemapPolicy: 'auto'|'always'|'never' }} state
 * @returns {import('astro').AstroIntegration}
 */
function sitemapFinalizerIntegration(config, state) {
  return {
    name: 'astro-aeo/sitemap-finalizer',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        finalizeSitemapOutputs(dir, config, {
          siteUrl: state.siteUrl,
          base: state.base,
          sitemapPolicy: state.sitemapPolicy,
          sitemapExpected: state.expected,
          logger,
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
