// @ts-check
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import sitemap from '@astrojs/sitemap';
import { resolveConfig } from './config.js';
import {
  resolveSitemapPlan,
  sitemapPathExists,
  sitemapPathMatchesRoute,
} from './lib/sitemap.js';
import { finalizeSitemapOutputs } from './generators/sitemap-finalize.js';
import { onBuildDone } from './hooks/build-done.js';
import { aeoRuntimeConfigPlugin } from './virtual/plugin.js';
import { findNonSerializable, nonSerializableWarning } from './virtual/serialize.js';
import { createArtifactWriter } from './build/artifacts.js';

/**
 * @param {import('./index.js').AstroAeoConfig} [userConfig]
 * @returns {import('astro').AstroIntegration}
 */
export default function aeo(userConfig = {}) {
  const internalRequestToken = randomBytes(32).toString('hex');
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
  /** @type {'dev'|'build'|'preview'} */
  let command = 'build';
  const sitemapState = {
    expected: false,
    siteUrl: '',
    base: '',
  };
  /** @type {Map<string, string>} */
  const routeEntrypoints = new Map();
  /** @type {Set<string>} */
  const resolvedRoutePaths = new Set();
  /** @type {Set<string>} */
  const runtimeProjectPaths = new Set();
  /** @type {RegExp[]} */
  const runtimeProjectPatterns = [];
  /** @type {Set<string>} */
  const runtimePagePaths = new Set();
  let serverOutput = false;
  let hasOnDemandProjectPage = false;
  /** @type {import('./index.js').Diagnostic[]} */
  const buildDiagnostics = [];
  /** @type {{ warn: (message: string) => void } | undefined} */
  let integrationLogger;
  /** @type {ReturnType<typeof createArtifactWriter> | undefined} */
  let artifactWriter;

  /**
   * @returns {Record<string, unknown>}
   */
  function runtimeSnapshot() {
    const sitemapPath = config.discovery.robots.sitemapPath;
    const sitemapAvailable =
      Boolean(publicDir && sitemapPathExists(publicDir, sitemapPath)) ||
      sitemapPathMatchesRoute(sitemapPath, [...resolvedRoutePaths]);
    return {
      command,
      config,
      site: { siteUrl, base, trailingSlash, buildFormat },
      sitemapAvailable,
      staticPaths: [...runtimePagePaths],
      projectPaths: [...runtimeProjectPaths],
      projectPatterns: runtimeProjectPatterns,
      internalRequestToken,
      standaloneSources: {},
    };
  }

  return {
    name: 'astro-aeo',
    hooks: {
      'astro:config:setup': ({ config: astroConfig, command: astroCommand, addMiddleware, updateConfig, logger }) => {
        config = resolveConfig(userConfig, logger);
        integrationLogger = logger;
        const nonSerializable = findNonSerializable(config);
        if (nonSerializable.length > 0) logger.warn(nonSerializableWarning(nonSerializable));
        command = astroCommand === 'dev' ? 'dev' : astroCommand === 'preview' ? 'preview' : 'build';
        const hasUserSitemap = (astroConfig.integrations ?? []).some(
          (i) => i && i.name === '@astrojs/sitemap',
        );
        const plan = resolveSitemapPlan({
          mode: config.discovery.sitemap.mode,
          hasUserSitemap,
          hasSite: Boolean(astroConfig.site),
        });
        if (plan.warning) logger.warn(plan.warning);
        sitemapState.expected = plan.expected;

        const added = [];
        if (plan.register) {
          added.push(sitemap(/** @type {any} */ (config.discovery.sitemap.options)));
        }
        added.push(
          sitemapFinalizerIntegration(
            config,
            sitemapState,
            () => ({ routePaths: resolvedRoutePaths, publicDir }),
            () => artifactWriter,
          ),
        );
        updateConfig({
          integrations: added,
          vite: {
            plugins: [
              aeoRuntimeConfigPlugin(
                runtimeSnapshot,
                () =>
                  config.pages.catalogs.map(({ module }) =>
                    module.startsWith('.')
                      ? pathToFileURL(resolve(projectRoot, module)).href
                      : module,
                  ),
                () => runtimeMarkdownSourceEntries(routeEntrypoints, projectRoot),
              ),
            ],
          },
        });

        addMiddleware({ order: 'pre', entrypoint: 'astro-aeo/middleware' });
      },

      'astro:config:done': ({ config: astroConfig, logger, injectTypes }) => {
        config = config ?? resolveConfig(userConfig, logger);
        siteUrl = astroConfig.site ? astroConfig.site.toString().replace(/\/$/, '') : '';
        base = astroConfig.base && astroConfig.base !== '/' ? astroConfig.base : '';
        trailingSlash = astroConfig.trailingSlash ?? 'ignore';
        buildFormat = astroConfig.build?.format === 'file' ? 'file' : 'directory';
        serverOutput = astroConfig.output === 'server';
        projectRoot = fileURLToPath(astroConfig.root);
        publicDir = astroConfig.publicDir;

        injectTypes({
          filename: 'astro-aeo.d.ts',
          content:
            'declare namespace App {\n' +
            '  interface Locals {\n' +
            '    /** Internal collection flag set only while Astro-AEO renders a representation. */\n' +
            '    astroAeoCollect?: boolean;\n' +
            '  }\n' +
            '}\n',
        });

        if (config.markdown.negotiation !== 'off' && !astroConfig.adapter) {
          logger.warn(
            `astro-aeo: markdown.negotiation is "${config.markdown.negotiation}" but this project has no adapter, so every route is prerendered and none can negotiate. ` +
              'Astro does not expose request headers to a prerendered route. Add an adapter and mark the routes that should negotiate with `export const prerender = false`, or set markdown.negotiation to "off". The .md companions are unaffected.',
          );
        }
        sitemapState.siteUrl = siteUrl;
        sitemapState.base = base;
      },

      'astro:routes:resolved': ({ routes }) => {
        routeEntrypoints.clear();
        resolvedRoutePaths.clear();
        runtimeProjectPaths.clear();
        runtimeProjectPatterns.length = 0;
        runtimePagePaths.clear();
        hasOnDemandProjectPage = false;
        artifactWriter = undefined;
        buildDiagnostics.length = 0;
        let hasUncatalogedDynamicPage = false;
        let hasPrerenderedCustom404 = false;
        for (const route of routes) {
          const pathname = /** @type {string | undefined} */ (route.pathname);
          const normalizedPathname = pathname ? normalize(pathname) : undefined;
          const entrypoint = /** @type {string | undefined} */ (route.entrypoint);
          if (normalizedPathname) resolvedRoutePaths.add(normalizedPathname);
          if (pathname && entrypoint) {
            routeEntrypoints.set(normalizedPathname, entrypoint);
          }
          const type = /** @type {string | undefined} */ (route.type);
          const origin = /** @type {string | undefined} */ (route.origin);
          const projectRoute = origin === undefined || origin === 'project';
          if (projectRoute && normalizedPathname) runtimeProjectPaths.add(normalizedPathname);
          const pattern = /** @type {RegExp | undefined} */ (
            route.patternRegex ?? (route.pattern instanceof RegExp ? route.pattern : undefined)
          );
          const routePattern = /** @type {string | undefined} */ (
            typeof route.pattern === 'string' ? route.pattern : route.route
          );
          const prerendered = /** @type {boolean | undefined} */ (
            route.isPrerendered ?? route.prerender
          );
          if (
            projectRoute &&
            !normalizedPathname &&
            pattern instanceof RegExp &&
            (type !== 'page' || Boolean(routePattern && /\.[^/]+$/.test(routePattern)))
          ) {
            runtimeProjectPatterns.push(pattern);
          }
          if (
            projectRoute &&
            type === 'page' &&
            normalizedPathname &&
            normalizedPathname !== '/404' &&
            normalizedPathname !== '/500'
          ) {
            runtimePagePaths.add(normalizedPathname);
          }
          if (projectRoute && type === 'page' && prerendered === false) {
            hasOnDemandProjectPage = true;
          }
          if (projectRoute && !pathname && type !== 'endpoint' && type !== 'redirect') {
            hasUncatalogedDynamicPage = true;
          }
          if (projectRoute && normalizedPathname === '/404' && prerendered === true) {
            hasPrerenderedCustom404 = true;
          }
        }
        if (hasUncatalogedDynamicPage && config.pages.catalogs.length === 0) {
          const diagnostic = {
            version: /** @type {const} */ (1),
            code: 'dynamic-routes-unindexed',
            severity: /** @type {const} */ ('warning'),
            message:
              'Dynamic page routes cannot be enumerated for corpus indexes without pages.catalogs.',
          };
          buildDiagnostics.push(diagnostic);
          integrationLogger?.warn(
            'astro-aeo: dynamic page routes are not included in llms.txt because no pages.catalogs module is configured.',
          );
        }
        if (hasPrerenderedCustom404 && config.markdown.negotiation !== 'off') {
          const diagnostic = {
            version: /** @type {const} */ (1),
            code: 'prerendered-custom-404-negotiation',
            severity: /** @type {const} */ ('warning'),
            pathname: '/404',
            message:
              'A prerendered custom 404 cannot inspect Accept headers; direct .md requests remain available.',
          };
          buildDiagnostics.push(diagnostic);
          integrationLogger?.warn(
            'astro-aeo: the custom /404 route is prerendered and cannot negotiate Markdown. Keep direct .md companions, or render the 404 on demand.',
          );
        }
      },

      'astro:build:done': async (options) => {
        artifactWriter = await onBuildDone(config, /** @type {any} */ (options), {
          siteUrl,
          base,
          trailingSlash,
          buildFormat,
          projectRoot,
          routeEntrypoints,
          resolvedRoutePaths,
          publicDir,
          diagnostics: buildDiagnostics,
          runtimeCorpora: serverOutput || hasOnDemandProjectPage,
        });
      },
    },
  };
}

/**
 * @param {Map<string, string>} routeEntrypoints
 * @param {string} projectRoot
 * @returns {{ pathname: string; path: string; specifier: string }[]}
 */
function runtimeMarkdownSourceEntries(routeEntrypoints, projectRoot) {
  const sources = [];
  if (!projectRoot) return sources;
  for (const [pathname, entrypoint] of routeEntrypoints) {
    const cleaned = entrypoint.replace(/[?#].*$/, '');
    if (!cleaned.endsWith('.md')) continue;
    const path = cleaned.startsWith('file:')
      ? fileURLToPath(cleaned)
      : isAbsolute(cleaned)
        ? cleaned
        : resolve(projectRoot, cleaned);
    sources.push({ pathname, path: entrypoint, specifier: path });
  }
  return sources;
}

/**
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{ expected: boolean; siteUrl: string; base: string }} state
 * @param {() => { routePaths: Set<string>; publicDir: URL | undefined }} collisionInputs
 * @param {() => ReturnType<typeof createArtifactWriter> | undefined} retainedWriter
 * @returns {import('astro').AstroIntegration}
 */
function sitemapFinalizerIntegration(config, state, collisionInputs, retainedWriter) {
  return {
    name: 'astro-aeo/sitemap-finalizer',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const inputs = collisionInputs();
        const writer =
          retainedWriter() ??
          createArtifactWriter({
            distDir: dir,
            logger,
            routePaths: inputs.routePaths,
            publicDir: inputs.publicDir,
          });
        finalizeSitemapOutputs(dir, config, {
          siteUrl: state.siteUrl,
          base: state.base,
          sitemapExpected: state.expected,
          logger,
          ...inputs,
          writer,
        });
        writer.report();
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
