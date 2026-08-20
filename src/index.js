// @ts-check
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
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
import { exactPathnameIdentity } from './core/artifact-path.js';
import { createLocaleSnapshot } from './core/locale.js';
import {
  preloadCorpusTokenizer,
  runtimeCorpusTokenizerModule,
} from './build/corpus-tokenizer.js';
import {
  INDEXNOW_PREPARE_PROVIDER,
  indexNowPaths,
  indexNowStatePathname,
} from './build/indexnow.js';
import { parseIndexNowPrepareInput } from './build/indexnow-state.js';

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
  let pagesDir = '';
  let localeSnapshot = createLocaleSnapshot(undefined);
  /** @type {URL | undefined} */
  let publicDir;
  /** @type {'dev'|'build'|'preview'} */
  let command = 'build';
  /** @type {'dev'|'build'|'preview'|'sync'} */
  let astroLifecycleCommand = 'build';
  /** @type {'static'|'server'|undefined} */
  let exactBuildOutput;
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
  let hasDynamicProjectPage = false;
  let hasOnDemandDynamicProjectPage = false;
  let hasPrerenderedCustom404 = false;
  let developmentDynamicWarningEmitted = false;
  let initialDynamicRoutesCaptured = false;
  /** @type {{ entrypoint: string; pattern: string; params: string[]; segments: Array<Array<{ content: string; dynamic: boolean; spread: boolean }>> }[]} */
  let initialDynamicRoutes = [];
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
  /** @type {import('./build/corpus-tokenizer.js').LoadedCorpusTokenizer | undefined} */
  let corpusTokenizer;
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
      site: { siteUrl, base, trailingSlash, buildFormat, i18n: localeSnapshot },
      sitemapAvailable,
      staticPaths: [...runtimePagePaths],
      projectPaths: [...new Set([...runtimeProjectPaths, ...runtimePublicPaths])],
      projectPatterns: runtimeProjectPatterns,
      standaloneSources: {},
      pluginManifest: pluginDispatcher?.runtimeManifest ?? { version: 1, plugins: [] },
    };
  }

  /** @returns {import('./virtual/plugin.js').DynamicRouteModuleConfig | null} */
  function dynamicRouteModuleConfig() {
    if (
      astroLifecycleCommand !== 'dev' ||
      !config ||
      config.pages.devDynamicDiscovery === false
    ) {
      return null;
    }
    if (config.pages.devDynamicDiscovery === 'hot') {
      const relativePagesDir = projectRoot && pagesDir ? relative(projectRoot, pagesDir) : '..';
      const safeRelative = relativePagesDir &&
        !isAbsolute(relativePagesDir) &&
        relativePagesDir !== '..' &&
        !/^\.\.(?:[\\/]|$)/.test(relativePagesDir);
      return {
        mode: 'hot',
        routes: [],
        projectRoot,
        warnOnDemand:
          config.pages.catalogs.length === 0 && !developmentDynamicWarningEmitted,
        ...(safeRelative
          ? { pagesGlob: `/${escapeViteGlobPath(relativePagesDir)}/**/*` }
          : {}),
      };
    }
    return {
      mode: 'startup',
      routes: initialDynamicRoutes.map((route) => ({
        ...route,
        specifier: resolveRouteEntrypoint(route.entrypoint, projectRoot),
      })),
    };
  }

  const integration = {
    name: 'astro-aeo',
    hooks: {
      'astro:config:setup': async ({ config: astroConfig, command: astroCommand, addMiddleware, injectRoute, updateConfig, logger }) => {
        config = resolveConfig(userConfig, logger);
        integrationLogger = logger;
        astroLifecycleCommand = astroCommand;
        exactBuildOutput = undefined;
        developmentDynamicWarningEmitted = false;
        initialDynamicRoutesCaptured = false;
        initialDynamicRoutes = [];
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
            (diagnostic) => buildDiagnostics.push(diagnostic),
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
                () => runtimeCorpusTokenizerModule(corpusTokenizer),
                dynamicRouteModuleConfig,
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
        localeSnapshot = createLocaleSnapshot(astroConfig.i18n, siteUrl);
        exactBuildOutput = buildOutput;
        serverOutput = buildOutput === 'server' || astroConfig.output === 'server' || adapterFallbacks;
        projectRoot = fileURLToPath(astroConfig.root);
        pagesDir = astroConfig.srcDir
          ? fileURLToPath(new URL('pages/', astroConfig.srcDir))
          : resolve(projectRoot, 'src/pages');
        publicDir = astroConfig.publicDir;
        runtimePublicPaths.clear();
        if (publicDir) {
          for (const pathname of publicRuntimePathnames(publicDir)) {
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
        corpusTokenizer = await preloadCorpusTokenizer(
          config.corpus.tokenizer,
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
        hasDynamicProjectPage = false;
        hasOnDemandDynamicProjectPage = false;
        hasPrerenderedCustom404 = false;
        artifactWriter = undefined;
        buildDiagnostics.length = 0;
        /** @type {typeof initialDynamicRoutes} */
        const currentDynamicRoutes = [];
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
          const dynamicProjectPage = projectRoute && type === 'page' && pathname == null;
          if (dynamicProjectPage) {
            hasDynamicProjectPage = true;
            if (prerendered === false) hasOnDemandDynamicProjectPage = true;
            if (
              prerendered === true &&
              typeof entrypoint === 'string' &&
              typeof routePattern === 'string' &&
              Array.isArray(route.params) &&
              Array.isArray(route.segments)
            ) {
              currentDynamicRoutes.push({
                entrypoint,
                pattern: routePattern,
                params: route.params.filter((value) => typeof value === 'string'),
                segments: route.segments.map((segment) => Array.isArray(segment)
                  ? segment.map((part) => ({
                    content: typeof part?.content === 'string' ? part.content : '',
                    dynamic: part?.dynamic === true,
                    spread: part?.spread === true,
                  }))
                  : []),
              });
            }
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
        if (astroLifecycleCommand === 'dev' && !initialDynamicRoutesCaptured) {
          initialDynamicRoutes = currentDynamicRoutes;
          initialDynamicRoutesCaptured = true;
        }
        if (
          astroLifecycleCommand === 'dev' &&
          !developmentDynamicWarningEmitted &&
          config.pages.catalogs.length === 0
        ) {
          if (hasOnDemandDynamicProjectPage) {
            developmentDynamicWarningEmitted = true;
            integrationLogger?.warn(
              'astro-aeo: on-demand dynamic page routes require pages.catalogs for development corpus enumeration.',
            );
          } else if (config.pages.devDynamicDiscovery === false && hasDynamicProjectPage) {
            developmentDynamicWarningEmitted = true;
            integrationLogger?.warn(
              'astro-aeo: the development corpus is incomplete because pages.devDynamicDiscovery is false and no pages.catalogs module is configured.',
            );
          }
        }
      },

      'astro:build:done': async (options) => {
        // Astro 5 resolves routes before config:done, while newer versions run
        // these hooks in the opposite order. Merge here, after catalog preflight
        // is guaranteed to have completed, and keep the route array catalog-free
        // so the newer hook order cannot add the same diagnostics twice.
        /** @type {import('./index.js').Diagnostic[]} */
        const routeDiagnostics = [];
        if (
          exactBuildOutput === 'server' &&
          hasDynamicProjectPage &&
          config.pages.catalogs.length === 0
        ) {
          routeDiagnostics.push({
            version: 1,
            code: 'dynamic-routes-unindexed',
            severity: 'warning',
            message:
              'Request-time corpus enumeration is incomplete for dynamic page routes because no pages.catalogs module is configured.',
          });
          integrationLogger?.warn(
            'astro-aeo: dynamic page routes require pages.catalogs for request-time corpus enumeration in server output.',
          );
        }
        if (hasPrerenderedCustom404 && config.markdown.negotiation !== 'off') {
          routeDiagnostics.push({
            version: 1,
            code: 'prerendered-custom-404-negotiation',
            severity: 'warning',
            pathname: '/404',
            message:
              'A prerendered custom 404 cannot inspect Accept headers; direct .md requests remain available.',
          });
          integrationLogger?.warn(
            'astro-aeo: the custom /404 route is prerendered and cannot negotiate Markdown. Keep direct .md companions, or render the 404 on demand.',
          );
        }
        const diagnostics = [
          ...catalogDiagnostics,
          ...rendererDiagnostics,
          ...buildDiagnostics,
          ...routeDiagnostics,
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
          corpusTokenizer: corpusTokenizer?.implementation,
          pluginDispatcher,
          i18n: localeSnapshot,
        });
      },
    },
  };
  Object.defineProperty(integration, INDEXNOW_PREPARE_PROVIDER, {
    enumerable: false,
    value: ({ root, astroConfig }) => {
      const resolved = resolveConfig(userConfig);
      if (!resolved.discovery.indexNow.enabled) {
        throw new Error('astro-aeo: discovery.indexNow.enabled is false in the loaded config');
      }
      const path = indexNowPaths(root).prepareInput;
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('astro-aeo: the cached IndexNow prepare input is not a safe regular file');
      }
      const cached = parseIndexNowPrepareInput(JSON.parse(readFileSync(path, 'utf8')));
      const nextBase = astroConfig?.base && astroConfig.base !== '/' ? astroConfig.base : '';
      const configured = new Map(resolved.discovery.indexNow.origins.map((item) => [item.origin, item]));
      const origins = cached.origins.map((item) => {
        const override = configured.get(item.origin);
        return {
          origin: item.origin,
          ...(override?.key ? { key: override.key } : {}),
          ...(override?.keyLocation ? { keyLocation: override.keyLocation } : {}),
          ...(item.targetDigest ? { targetDigest: item.targetDigest } : {}),
        };
      });
      for (const item of resolved.discovery.indexNow.origins) {
        if (!origins.some((candidate) => candidate.origin === item.origin)) origins.push({ ...item });
      }
      return {
        ...cached,
        projectRoot: root,
        mode: resolved.discovery.indexNow.state,
        submit: resolved.discovery.indexNow.submit,
        strict: resolved.discovery.indexNow.strict,
        base: nextBase,
        statePathname: indexNowStatePathname(nextBase),
        key: resolved.discovery.indexNow.key,
        ...(resolved.discovery.indexNow.keyLocation
          ? { keyLocation: resolved.discovery.indexNow.keyLocation }
          : { keyLocation: undefined }),
        origins,
      };
    },
  });
  return integration;
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
 * @param {string} entrypoint
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveRouteEntrypoint(entrypoint, projectRoot) {
  const cleaned = entrypoint.replace(/[?#].*$/, '');
  if (cleaned.startsWith('file:')) return fileURLToPath(cleaned);
  return isAbsolute(cleaned) ? cleaned : resolve(projectRoot, cleaned);
}

/**
 * Escape the literal directory portion of a root-relative Vite glob. The
 * appended globstar remains active so every page extension stays eligible.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeViteGlobPath(value) {
  return value
    .replaceAll('\\', '/')
    .replace(/(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\())/g, '\\$&');
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
  for (const pathname of artifacts) {
    // Astro decodes concrete request pathnames before applying its generated
    // route regex. Inject the decoded identity while retaining the canonical
    // encoded spelling everywhere that is public or persisted.
    const pattern = exactPathnameIdentity(pathname, 'runtime artifact pathname').key
      // Brackets are Astro's dynamic-route syntax. Its parser recognizes their
      // encoded spelling as literal brackets while still decoding ordinary URL
      // bytes before matching the generated regex.
      .replace(/\[/g, '%5B')
      .replace(/\]/g, '%5D');
    injectRoute({ pattern, entrypoint: FALLBACK_ENTRYPOINT, prerender: false });
  }
}

/**
 * Public files are external runtime owners just like project and integration
 * routes. Their physical path is app-relative: Astro mounts the public
 * directory at the configured base rather than requiring a second base folder
 * inside public/. Symlinks are ignored so configuration discovery never follows
 * a project-controlled path outside publicDir.
 *
 * @param {URL} publicDir
 * @returns {string[]}
 */
function publicRuntimePathnames(publicDir) {
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
  return files.map(normalize);
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
 * @param {(diagnostic: import('./index.js').Diagnostic) => void} [onDiagnostic]
 * @returns {import('astro').AstroIntegration}
 */
function sitemapFinalizerIntegration(config, state, collisionInputs, retainedWriter, onDiagnostic) {
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
          onDiagnostic,
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
