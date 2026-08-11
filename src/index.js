// @ts-check
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
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
import {
  findNonSerializable,
  nonSerializableWarning,
  runtimeConfigProjection,
} from './virtual/serialize.js';
import { createArtifactWriter } from './build/artifacts.js';
import { preloadCatalogModules } from './build/catalogs.js';
import {
  assertInlineMarkdownRenderersSupported,
  preloadMarkdownRenderers,
  runtimeMarkdownRendererModules,
} from './build/markdown-renderers.js';
import { createPluginDispatcher } from './plugins/dispatcher.js';
import { runtimePluginModules } from './plugins/runtime-modules.js';
import { createSemanticPlugin } from './semantic/plugin.js';

const FALLBACK_ENTRYPOINT = fileURLToPath(new URL('./runtime/fallback.js', import.meta.url));

/**
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
  /** @type {{ pattern: RegExp; prerendered: boolean }[]} */
  const resolvedRouteMatchers = [];
  /** @type {Set<string>} */
  const runtimeProjectPaths = new Set();
  /** @type {Set<string>} */
  const runtimePublicPaths = new Set();
  /** @type {RegExp[]} */
  const runtimeProjectPatterns = [];
  /** @type {Set<string>} */
  const runtimePagePaths = new Set();
  let serverOutput = false;
  let adapterFallbacks = false;
  let hasOnDemandProjectPage = false;
  /** @type {import('./index.js').Diagnostic[]} */
  const buildDiagnostics = [];
  /** @type {import('./index.js').Diagnostic[]} */
  const catalogDiagnostics = [];
  /** @type {import('./index.js').Diagnostic[]} */
  const rendererDiagnostics = [];
  /** @type {{ module: string; specifier: string; namespace: any }[]} */
  let catalogModules = [];
  /** @type {import('./build/markdown-renderers.js').LoadedMarkdownRenderer[]} */
  let markdownRenderers = [];
  /** @type {{ warn: (message: string) => void } | undefined} */
  let integrationLogger;
  /** @type {ReturnType<typeof createArtifactWriter> | undefined} */
  let artifactWriter;
  /** @type {Awaited<ReturnType<typeof createPluginDispatcher>> | undefined} */
  let pluginDispatcher;

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
      config: runtimeConfigProjection(config),
      site: { siteUrl, base, trailingSlash, buildFormat },
      sitemapAvailable,
      staticPaths: [...runtimePagePaths],
      projectPaths: [...new Set([...runtimeProjectPaths, ...runtimePublicPaths])],
      projectPatterns: runtimeProjectPatterns,
      standaloneSources: {},
      pluginManifest: pluginDispatcher?.runtimeManifest ?? { version: 1, plugins: [] },
    };
  }

  return {
    name: 'astro-aeo',
    hooks: {
      'astro:config:setup': async ({ config: astroConfig, command: astroCommand, addMiddleware, injectRoute, updateConfig, logger }) => {
        config = resolveConfig(userConfig, logger);
        integrationLogger = logger;
        if (astroConfig.root) projectRoot = fileURLToPath(astroConfig.root);
        const nonSerializable = findNonSerializable(runtimeConfigProjection(config));
        if (nonSerializable.length > 0) logger.warn(nonSerializableWarning(nonSerializable));
        command = astroCommand === 'dev' ? 'dev' : astroCommand === 'preview' ? 'preview' : 'build';
        pluginDispatcher = await createPluginDispatcher({
          command,
          plugins: config.plugins,
          internalPlugins: [createSemanticPlugin(config)],
        });
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

        adapterFallbacks = Boolean(astroConfig.adapter);
        if (adapterFallbacks && injectRoute) {
          const runtimeClaims = pluginDispatcher.runtimeManifest.plugins.flatMap(
            (plugin) => plugin.claims,
          );
          injectRuntimeFallbackRoutes(config, injectRoute, runtimeClaims);
        }

        const added = [];
        if (plan.register) {
          added.push(sitemap(/** @type {any} */ (config.discovery.sitemap.options)));
        }
        added.push(
          sitemapFinalizerIntegration(
            config,
            sitemapState,
            () => ({ routePaths: resolvedRoutePaths, routeMatchers: resolvedRouteMatchers, publicDir }),
            () => artifactWriter,
          ),
        );
        updateConfig({
          integrations: added,
          vite: {
            plugins: [
              aeoRuntimeConfigPlugin(
                runtimeSnapshot,
                () => catalogModules.map(({ module, specifier }) => ({ module, specifier })),
                () => runtimeMarkdownSourceEntries(routeEntrypoints, projectRoot),
                () => runtimeMarkdownRendererModules(markdownRenderers),
                () => runtimePluginModules(
                  pluginDispatcher?.runtimeManifest ?? { version: 1, plugins: [] },
                  projectRoot,
                ),
              ),
            ],
          },
        });

        addMiddleware({ order: 'pre', entrypoint: 'astro-aeo/middleware' });
      },

      'astro:config:done': async ({ config: astroConfig, logger, injectTypes, buildOutput }) => {
        config = config ?? resolveConfig(userConfig, logger);
        siteUrl = astroConfig.site ? astroConfig.site.toString().replace(/\/$/, '') : '';
        base = astroConfig.base && astroConfig.base !== '/' ? astroConfig.base : '';
        trailingSlash = astroConfig.trailingSlash ?? 'ignore';
        buildFormat = astroConfig.build?.format === 'file' ? 'file' : 'directory';
        serverOutput = buildOutput === 'server' || astroConfig.output === 'server' || adapterFallbacks;
        projectRoot = fileURLToPath(astroConfig.root);
        publicDir = astroConfig.publicDir;
        runtimePublicPaths.clear();
        if (publicDir) {
          for (const pathname of publicRuntimePathnames(publicDir, base)) {
            runtimePublicPaths.add(pathname);
          }
        }
        catalogDiagnostics.length = 0;
        catalogModules = await preloadCatalogModules(
          config.pages.catalogs,
          projectRoot,
          logger,
          catalogDiagnostics,
        );
        rendererDiagnostics.length = 0;
        markdownRenderers = await preloadMarkdownRenderers(
          config.markdown.renderers ?? [],
          projectRoot,
          logger,
          rendererDiagnostics,
        );
        assertInlineMarkdownRenderersSupported(config.markdown.renderers ?? [], {
          command,
          serverOutput,
          hasOnDemandPage: hasOnDemandProjectPage,
        });

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
        resolvedRouteMatchers.length = 0;
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
          const runtimePathname = normalizedPathname
            ? canonicalRuntimePath(normalizedPathname)
            : undefined;
          const entrypoint = /** @type {string | undefined} */ (route.entrypoint);
          if (entrypoint && isRuntimeFallbackEntrypoint(entrypoint, projectRoot)) continue;
          const type = /** @type {string | undefined} */ (route.type);
          const origin = /** @type {string | undefined} */ (route.origin);
          const projectRoute = origin === undefined || origin === 'project';
          // Astro internal routes are implementation details, not user artifact
          // ownership. Every other route, including routes contributed by an
          // integration, must win over Astro-AEO at runtime. Our tagged fallback
          // routes returned above and are the only external routes omitted here.
          const ownedRoute = origin !== 'internal';
          if (ownedRoute && normalizedPathname) resolvedRoutePaths.add(normalizedPathname);
          if (ownedRoute && pathname && entrypoint) {
            routeEntrypoints.set(normalizedPathname, entrypoint);
          }
          if (ownedRoute && runtimePathname) runtimeProjectPaths.add(runtimePathname);
          const pattern = /** @type {RegExp | undefined} */ (
            route.patternRegex ?? (route.pattern instanceof RegExp ? route.pattern : undefined)
          );
          const routePattern = /** @type {string | undefined} */ (
            typeof route.pattern === 'string' ? route.pattern : route.route
          );
          const prerendered = /** @type {boolean | undefined} */ (
            route.isPrerendered ?? route.prerender
          );
          const ownsExtensionPath =
            ownedRoute &&
            !normalizedPathname &&
            pattern instanceof RegExp &&
            (type !== 'page' || Boolean(routePattern && /\.[^/]+$/.test(routePattern)));
          // A generic dynamic page such as /[slug] is not a literal artifact
          // claim. Treating it as one would suppress every one-segment .md or
          // text artifact even though Astro's static asset layer owns those
          // emitted files. Dynamic endpoints and extension-bearing page
          // patterns remain project ownership and continue to win.
          if (ownsExtensionPath) {
            resolvedRouteMatchers.push({ pattern, prerendered: prerendered !== false });
            runtimeProjectPatterns.push(pattern);
          }
          if (
            projectRoute &&
            type === 'page' &&
            runtimePathname &&
            runtimePathname !== '/404' &&
            runtimePathname !== '/500'
          ) {
            runtimePagePaths.add(runtimePathname);
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
        assertInlineMarkdownRenderersSupported(config.markdown.renderers ?? [], {
          command,
          serverOutput,
          hasOnDemandPage: hasOnDemandProjectPage,
        });
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
        // Astro 5 resolves routes before config:done, while newer versions run
        // these hooks in the opposite order. Merge here, after catalog preflight
        // is guaranteed to have completed, and keep the route array catalog-free
        // so the newer hook order cannot add the same diagnostics twice.
        const diagnostics = [
          ...catalogDiagnostics,
          ...rendererDiagnostics,
          ...buildDiagnostics,
        ];
        artifactWriter = await onBuildDone(config, /** @type {any} */ (options), {
          siteUrl,
          base,
          trailingSlash,
          buildFormat,
          projectRoot,
          routeEntrypoints,
          resolvedRoutePaths,
          resolvedRouteMatchers,
          publicDir,
          diagnostics,
          runtimeCorpora: serverOutput || hasOnDemandProjectPage,
          catalogModules,
          markdownRenderers,
          pluginDispatcher,
        });
      },
    },
  };
}

/**
 * @param {Map<string, string>} routeEntrypoints
 * @param {string} projectRoot
 * @returns {{ pathname: string; path: string; specifier: string; kind: 'markdown'|'mdx' }[]}
 */
function runtimeMarkdownSourceEntries(routeEntrypoints, projectRoot) {
  const sources = [];
  if (!projectRoot) return sources;
  for (const [pathname, entrypoint] of routeEntrypoints) {
    const cleaned = entrypoint.replace(/[?#].*$/, '');
    if (!/\.mdx?$/.test(cleaned)) continue;
    const path = cleaned.startsWith('file:')
      ? fileURLToPath(cleaned)
      : isAbsolute(cleaned)
        ? cleaned
        : resolve(projectRoot, cleaned);
    sources.push({
      pathname: canonicalRuntimePath(pathname),
      path: entrypoint,
      specifier: path,
      kind: cleaned.endsWith('.mdx') ? 'mdx' : 'markdown',
    });
  }
  return sources;
}

/**
 * Give adapters concrete manifest routes that reach pre-middleware before the
 * provider's status-404 fallback. The endpoint itself succeeds at nothing: it
 * returns 404 only after Astro-AEO declines the request.
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {(route: { pattern: string; entrypoint: string; prerender: false }) => void} injectRoute
 * @param {readonly import('./index.js').PluginArtifactClaim[]} [pluginClaims]
 */
function injectRuntimeFallbackRoutes(config, injectRoute, pluginClaims = []) {
  if (config.markdown.enabled) {
    injectRoute({
      pattern: '/[...astroAeoMarkdown].md',
      entrypoint: FALLBACK_ENTRYPOINT,
      prerender: false,
    });
  }

  const artifacts = new Set();
  if (config.discovery.robots.enabled) artifacts.add('/robots.txt');
  if (config.site.profile.enabled) artifacts.add('/.well-known/domain-profile.json');
  if (config.corpus.index.enabled) artifacts.add('/llms.txt');
  if (config.corpus.full.enabled) artifacts.add('/llms-full.txt');
  if (config.schema?.corpus.enabled) {
    artifacts.add(config.schema.corpus.graphPath);
    artifacts.add(config.schema.corpus.mapPath);
  }
  for (const claim of pluginClaims) artifacts.add(claim.pathname);
  for (const pattern of artifacts) {
    injectRoute({ pattern, entrypoint: FALLBACK_ENTRYPOINT, prerender: false });
  }
}

/**
 * Public files are external runtime owners just like project and integration
 * routes. Record only files served inside Astro's configured base. Symlinks are
 * ignored so configuration discovery never follows a project-controlled path
 * outside publicDir.
 *
 * @param {URL} publicDir
 * @param {string} base
 * @returns {string[]}
 */
function publicRuntimePathnames(publicDir, base) {
  const root = fileURLToPath(publicDir);
  const files = [];
  /** @param {string} directory @param {string[]} parts */
  const visit = (directory, parts) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const nextParts = [...parts, entry.name];
      if (entry.isDirectory()) visit(resolve(directory, entry.name), nextParts);
      else if (entry.isFile()) files.push(`/${nextParts.join('/')}`);
    }
  };
  visit(root, []);
  const prefix = base && base !== '/' ? normalize(base) : '';
  return files.flatMap((pathname) => {
    const normalized = normalize(pathname);
    if (!prefix) return [normalized];
    return normalized.startsWith(`${prefix}/`)
      ? [normalized.slice(prefix.length)]
      : [];
  });
}

/** @param {string} entrypoint @param {string} projectRoot */
function isRuntimeFallbackEntrypoint(entrypoint, projectRoot) {
  const cleaned = entrypoint.replace(/[?#].*$/, '');
  try {
    const absolute = cleaned.startsWith('file:')
      ? fileURLToPath(cleaned)
      : isAbsolute(cleaned)
        ? cleaned
        : projectRoot
          ? resolve(projectRoot, cleaned)
          : '';
    return absolute === FALLBACK_ENTRYPOINT;
  } catch {
    return false;
  }
}

/**
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{ expected: boolean; siteUrl: string; base: string }} state
 * @param {() => { routePaths: Set<string>; routeMatchers: { pattern: RegExp; prerendered: boolean }[]; publicDir: URL | undefined }} collisionInputs
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
            routeMatchers: inputs.routeMatchers,
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

/** @param {string} pathname @returns {string} */
function canonicalRuntimePath(pathname) {
  return normalize(pathname);
}
