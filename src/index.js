// @ts-check
import { randomUUID } from 'node:crypto';
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
import { absoluteUrl } from './core/page-model.js';
import { chunkTopology } from './core/corpus-artifacts.js';
import { createLocaleSnapshot } from './core/locale.js';
import {
  preloadCorpusTokenizer,
  runtimeCorpusTokenizerModule,
} from './build/corpus-tokenizer.js';
import {
  INDEXNOW_PREPARE_PROVIDER,
  eligibleIndexNowOrigins,
  indexNowPaths,
  indexNowStatePathname,
  normalizeIndexNowOrigin,
} from './build/indexnow.js';
import { parseIndexNowPrepareInput } from './build/indexnow-state.js';
import { edgeProviderOf } from './edge/plugin.js';

const FALLBACK_ENTRYPOINT = fileURLToPath(new URL('./runtime/fallback.js', import.meta.url));

/**
 * @param {import('./index.js').AstroAeoConfig} [userConfig]
 * @returns {import('astro').AstroIntegration}
 */
/**
 * Astro reports the bound address, which may be a wildcard when `--host` is
 * used. A wildcard is not a destination, so the loopback address for the same
 * family is used instead. The port always comes from Astro.
 * @param {{ address?: string; family?: string | number; port?: number }} address
 * @returns {string}
 */
function loopbackOrigin(address) {
  const port = address.port;
  const family = String(address.family ?? '').toLowerCase();
  const ipv6 = family === 'ipv6' || family === '6' || (address.address ?? '').includes(':');
  const wildcard = !address.address || address.address === '0.0.0.0' || address.address === '::';
  const host = wildcard ? (ipv6 ? '::1' : '127.0.0.1') : address.address;
  return `http://${ipv6 ? `[${host}]` : host}${port ? `:${port}` : ''}`;
}

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
  /** @type {ReturnType<typeof edgeProviderOf>} */
  let edgeProvider = null;
  /** @type {string | null} */
  let adapterName = null;
  let hasDynamicProjectPage = false;
  let hasOnDemandDynamicProjectPage = false;
  let hasPrerenderedCustom404 = false;
  // Two independent latches. One shared flag let whichever message fired first
  // suppress the other, so a project with both an on-demand dynamic page and
  // `devDynamicDiscovery: false` never heard about the second problem.
  let developmentOnDemandWarningEmitted = false;
  let developmentDiscoveryWarningEmitted = false;
  let initialDynamicRoutesCaptured = false;
  /** @type {{ origin: string; nonce: string } | null} */
  let devLoopback = null;
  /** @type {{ entrypoint: string; pattern: string; params: string[]; segments: Array<Array<{ content: string; dynamic: boolean; spread: boolean }>> }[]} */
  let initialDynamicRoutes = [];
  /** @type {import('./index.js').Diagnostic[]} */
  const buildDiagnostics = [];
  /** @type {import('./index.js').Diagnostic[]} */
  const catalogDiagnostics = [];
  /** @type {import('./index.js').Diagnostic[]} */
  const rendererDiagnostics = [];
  /** Live diagnostics bag passed to the artifact writer and sitemap finalizer. */
  /** @type {import('./index.js').Diagnostic[]} */
  let activeDiagnostics = [];
  /** Absolute canonical URLs accepted by sitemap validation for runtime pages. */
  /** @type {Set<string>} */
  const runtimeCanonicalUrls = new Set();
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
      // The build wrote real corpus bytes, so a live render would be a second and
      // worse answer. Astro exposes injectRoute only in config:setup and has no
      // removeRoute, so the fallback routes cannot be withdrawn once the project
      // turns out to be fully prerendered. The runtime declines instead.
      buildOwnsCorpora: command !== 'dev' && !hasOnDemandProjectPage,
      // A dynamic route has no concrete pathname, so it never reaches staticPaths
      // and a live corpus would silently omit its getStaticPaths() results. Without
      // one, both answers agree and declining would only cost a working response.
      dynamicPagesUnreachable: hasDynamicProjectPage,
      staticPaths: [...runtimePagePaths],
      projectPaths: [...new Set([...runtimeProjectPaths, ...runtimePublicPaths])],
      projectPatterns: runtimeProjectPatterns,
      standaloneSources: {},
      pluginManifest: pluginDispatcher?.runtimeManifest ?? { version: 1, plugins: [] },
    };
  }

  /**
   * The development server's own listening address, as Astro reported it at
   * startup. Never derived from a request header, and never present outside
   * `astro dev`.
   * @returns {{ origin: string; nonce: string } | null}
   */
  function devLoopbackConfig() {
    return astroLifecycleCommand === 'dev' ? devLoopback : null;
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
        // Hot discovery owns this warning: only the loader sees routes that appear
        // after the last astro:routes:resolved, and a single owner keeps the
        // message from being emitted twice when the two orders interleave.
        warnOnDemand: config.pages.catalogs.length === 0,
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
        developmentOnDemandWarningEmitted = false;
        developmentDiscoveryWarningEmitted = false;
        devLoopback = null;
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
        adapterName = typeof astroConfig.adapter?.name === 'string' ? astroConfig.adapter.name : null;
        edgeProvider = edgeProviderOf(config.plugins);
        // Static edge negotiation exists for sites with no server. The gate reads the
        // adapter the project configured, never `serverOutput`, which Astro-AEO's own
        // fallback routes turn on for any adapter.
        if (edgeProvider && astroConfig.adapter) {
          throw new Error(
            `astro-aeo: the ${edgeProvider} static edge plugin is for sites without an adapter. ` +
            'This project configures one, so the Astro middleware already negotiates: remove the edge plugin.',
          );
        }
        if (edgeProvider && config.markdown.negotiation === 'off') {
          throw new Error(
            `astro-aeo: the ${edgeProvider} static edge plugin needs markdown.negotiation set to "response" or "redirect".`,
          );
        }
        // A generated artifact is a middleware claim, not a route, so Astro's router
        // treats its path as unmatched and falls back to `/404`. A page or endpoint
        // there still dispatches middleware, which is why an ordinary development
        // server serves artifacts with nothing injected. A redirect there does not:
        // Astro answers redirect routes in its routing layer, before middleware, so
        // every artifact path becomes that redirect and Astro-AEO is never asked.
        // Those projects need the same concrete routes an adapter build receives.
        //
        // This stays separate from `adapterFallbacks`, which also promotes a build to
        // server output: `astro dev` must imply nothing about the build.
        const devFallbackRoutes = command === 'dev' && redirectOwnsNotFound(astroConfig);
        if ((adapterFallbacks || devFallbackRoutes) && injectRoute) {
          const runtimeClaims = pluginDispatcher.runtimeManifest.plugins.flatMap(
            (plugin) => plugin.claims,
          );
          // `astro:config:done` is where `pagesDir` is normally recorded, and that runs
          // after the only hook exposing `injectRoute`. Derive it here for the one
          // question injection has to answer.
          const setupPagesDir = astroConfig.srcDir
            ? fileURLToPath(new URL('pages/', astroConfig.srcDir))
            : '';
          injectRuntimeFallbackRoutes(
            config,
            injectRoute,
            runtimeClaims,
            command === 'dev',
            setupPagesDir,
          );
        }

        const added = [];
        if (plan.register) {
          added.push(sitemap(/** @type {any} */ (config.discovery.sitemap.options)));
        }
        added.push(
          sitemapFinalizerIntegration(
            config,
            sitemapState,
            () => ({
              routePaths: resolvedRoutePaths,
              routeMatchers: resolvedRouteMatchers,
              publicDir,
              runtimeUrls: runtimeCanonicalUrls,
            }),
            () => artifactWriter,
            (diagnostic) => activeDiagnostics.push(diagnostic),
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
                devLoopbackConfig,
              ),
            ],
          },
        });

        addMiddleware({ order: 'pre', entrypoint: 'astro-aeo/middleware' });
      },

      // The fifth lifecycle hook, and the only reason for it: Astro reports the
      // development server's bound address here, which is the one destination
      // the development loopback fallback is allowed to use.
      'astro:server:start': ({ address }) => {
        if (astroLifecycleCommand !== 'dev' || !address) {
          devLoopback = null;
          return;
        }
        devLoopback = { origin: loopbackOrigin(address), nonce: randomUUID() };
      },

      'astro:config:done': async ({ config: astroConfig, logger, injectTypes, buildOutput }) => {
        config = config ?? resolveConfig(userConfig, logger);
        siteUrl = astroConfig.site ? astroConfig.site.toString().replace(/\/$/, '') : '';
        base = astroConfig.base && astroConfig.base !== '/' ? astroConfig.base : '';
        trailingSlash = astroConfig.trailingSlash ?? 'ignore';
        buildFormat = astroConfig.build?.format === 'file' ? 'file' : 'directory';
        localeSnapshot = createLocaleSnapshot(astroConfig.i18n, siteUrl);
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

        // An edge plugin is exactly how a project without an adapter negotiates.
        if (config.markdown.negotiation !== 'off' && !astroConfig.adapter && !edgeProvider) {
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
        activeDiagnostics = [];
        runtimeCanonicalUrls.clear();
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
          // That omission applies in `astro dev` too, where the same routes are
          // injected for a project whose 404 is a redirect.
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
            // The dots of a rest parameter are not a file extension: `/[...slug]` is a
            // generic page like `/[slug]`, while `/[...slug].json` does claim one.
            (type !== 'page' ||
              Boolean(routePattern && /\.[^/]+$/.test(routePattern.replace(/\[\.\.\.[^\]]*\]/g, '[rest]'))));
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
            if (edgeProvider) {
              throw new Error(
                `astro-aeo: the ${edgeProvider} static edge plugin requires every page to be prerendered, ` +
                `but ${routePattern ?? pathname ?? 'a page route'} renders on demand.`,
              );
            }
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
        if (astroLifecycleCommand === 'dev' && config.pages.catalogs.length === 0) {
          // Both conditions can hold at once, and they describe different gaps,
          // so neither message shadows the other.
          if (
            hasOnDemandDynamicProjectPage &&
            config.pages.devDynamicDiscovery !== 'hot' &&
            !developmentOnDemandWarningEmitted
          ) {
            developmentOnDemandWarningEmitted = true;
            integrationLogger?.warn(
              'astro-aeo: on-demand dynamic page routes require pages.catalogs for development corpus enumeration.',
            );
          }
          if (
            config.pages.devDynamicDiscovery === false &&
            hasDynamicProjectPage &&
            !developmentDiscoveryWarningEmitted
          ) {
            developmentDiscoveryWarningEmitted = true;
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

        // An on-demand page route is the only thing that puts pages outside the
        // build's reach. Adapter presence is not evidence: injectRuntimeFallbackRoutes
        // marks its own routes `prerender: false`, which promotes this build to server
        // output, so reading `buildOutput` back would be self-fulfilling.
        //
        // More than one configured origin also keeps the runtime authoritative: one
        // static file cannot be correct for every host it answers on. Astro rejects
        // prerendered routes under i18n.domains, so this only reaches a domains
        // project whose pages all come from catalogs.
        const corpusOwnedByRuntime = hasOnDemandProjectPage ||
          (localeSnapshot?.origins?.length ?? 0) > 1;
        /** @type {import('./index.js').Diagnostic[]} */
        const routeDiagnostics = [];
        if (
          corpusOwnedByRuntime &&
          hasDynamicProjectPage &&
          config.pages.catalogs.length === 0
        ) {
          routeDiagnostics.push({
            version: 1,
            code: 'dynamic-routes-unindexed',
            severity: 'warning',
            message:
              'Request-time middleware owns the corpus for this build, so dynamic page routes cannot be enumerated without a pages.catalogs module.',
          });
          integrationLogger?.warn(
            'astro-aeo: this build renders a page on demand, so request-time middleware owns the corpus. Dynamic page routes need pages.catalogs to appear in llms.txt and llms-full.txt.',
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
        activeDiagnostics = diagnostics;
        runtimeCanonicalUrls.clear();
        if (siteUrl) {
          for (const pathname of runtimePagePaths) {
            try {
              runtimeCanonicalUrls.add(absoluteUrl(siteUrl, base, pathname, trailingSlash));
            } catch {
              // Skip paths that cannot form a canonical absolute URL.
            }
          }
          for (const page of options.pages ?? []) {
            const pathname = typeof page?.pathname === 'string' ? page.pathname : null;
            if (!pathname) continue;
            try {
              runtimeCanonicalUrls.add(absoluteUrl(siteUrl, base, pathname, trailingSlash));
            } catch {
              // Skip paths that cannot form a canonical absolute URL.
            }
          }
        }
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
          runtimeCorpora: corpusOwnedByRuntime,
          catalogModules,
          markdownRenderers,
          corpusTokenizer: corpusTokenizer?.implementation,
          pluginDispatcher,
          i18n: localeSnapshot,
          edgeProvider,
          adapterName,
          serverOutput,
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
      // The cached input records the origins the build could notify. Configuration
      // may have retired one since, including an Astro i18n domain that never
      // carried an override, and retained cache state is scoped against this set.
      // Recompute it from the config just loaded; keep the cached set only when
      // this config names no usable site to recompute from.
      let eligibleOrigins;
      try {
        eligibleOrigins = [...eligibleIndexNowOrigins({
          primaryOrigin: normalizeIndexNowOrigin(String(astroConfig?.site ?? '')),
          i18nOrigins: createLocaleSnapshot(astroConfig?.i18n, String(astroConfig?.site ?? '')).origins,
          overrides: resolved.discovery.indexNow.origins,
          mode: resolved.discovery.indexNow.state,
        })].sort();
      } catch { eligibleOrigins = cached.eligibleOrigins; }
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
        ...(eligibleOrigins ? { eligibleOrigins } : { eligibleOrigins: undefined }),
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
 * The path segments Astro routes as locale prefixes. A locale is either a code or
 * an object naming the path it is served under, and only the path spelling can
 * appear in a URL.
 * @param {unknown} i18n
 * @returns {Set<string>}
 */
function localePathSegments(i18n) {
  /** @type {Set<string>} */
  const paths = new Set();
  if (!i18n || typeof i18n !== 'object') return paths;
  const locales = /** @type {{ locales?: unknown }} */ (i18n).locales;
  if (!Array.isArray(locales)) return paths;
  for (const locale of locales) {
    if (typeof locale === 'string') {
      paths.add(locale);
      continue;
    }
    const path = locale && typeof locale === 'object'
      ? /** @type {{ path?: unknown }} */ (locale).path
      : null;
    if (typeof path === 'string' && path) paths.add(path);
  }
  return paths;
}

/**
 * True when the project routes its own `/404` to a redirect. Astro resolves a
 * redirect route before middleware dispatch, so such a project reaches no
 * middleware for any path it does not otherwise route, including every generated
 * artifact. A trailing slash is not significant. Anything else at `/404`,
 * including no custom 404 at all, still dispatches middleware and needs nothing
 * injected.
 *
 * A locale-prefixed spelling counts, but only under a segment the project
 * actually configures as a locale. `redirects: { '/blog/404/': '/error/' }` in a
 * project with no `blog` locale redirects one concrete page and leaves the
 * router's own 404 alone, so injecting for it would change a development server
 * this gate exists to leave untouched.
 * @param {{ redirects?: unknown; i18n?: unknown }} astroConfig
 * @returns {boolean}
 */
function redirectOwnsNotFound(astroConfig) {
  const redirects = astroConfig.redirects;
  if (!redirects || typeof redirects !== 'object') return false;
  const locales = localePathSegments(astroConfig.i18n);
  return Object.keys(redirects).some((pattern) => {
    const trimmed = pattern.replace(/\/+$/, '');
    if (trimmed === '/404') return true;
    const prefixed = /^\/([^/]+)\/404$/.exec(trimmed);
    return prefixed !== null && locales.has(prefixed[1]);
  });
}

/**
 * Give the router concrete manifest routes that reach pre-middleware before the
 * provider's status-404 fallback in an adapter build, and before the development
 * server's redirect and 404 routing in `astro dev`. The endpoint itself succeeds at
 * nothing: it returns 404 only after Astro-AEO declines the request.
 *
 * A dynamic pattern must render on demand or Astro refuses to dispatch it without
 * `getStaticPaths()` paths, and middleware would never run. An exact path has no such
 * constraint, so the development server prerenders those: Astro forbids an on-demand
 * route from rewriting to a prerendered page, and every internal rewrite a corpus
 * needs would otherwise take the loopback detour. A build keeps every fallback on
 * demand, which is what makes adapter routing reach pre-middleware at all.
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {(route: { pattern: string; entrypoint: string; prerender: boolean }) => void} injectRoute
 * @param {readonly import('./index.js').PluginArtifactClaim[]} [pluginClaims]
 * @param {boolean} [prerenderExactPaths] development only, see above
 * @param {string} [pagesDir] absolute pages directory, for the collision check
 */
function injectRuntimeFallbackRoutes(
  config,
  injectRoute,
  pluginClaims = [],
  prerenderExactPaths = false,
  pagesDir = '',
) {
  if (config.markdown.enabled) {
    injectRoute({
      pattern: '/[...astroAeoMarkdown].md',
      entrypoint: FALLBACK_ENTRYPOINT,
      prerender: false,
    });
  }

  const mode = config.i18n.indexes;
  const topology = chunkTopology(mode);
  const artifacts = new Set();
  if (config.discovery.robots.enabled) artifacts.add('/robots.txt');
  if (config.site.profile.enabled) artifacts.add('/.well-known/domain-profile.json');
  if (config.corpus.index.enabled && mode !== 'locale') artifacts.add('/llms.txt');
  if (config.corpus.full.enabled && mode !== 'locale') artifacts.add('/llms-full.txt');
  if (config.corpus.small.enabled && mode !== 'locale') artifacts.add('/llms-small.txt');
  if (config.corpus.manifest.enabled) artifacts.add('/llms/manifest.json');
  if (config.schema?.corpus.enabled) {
    artifacts.add(config.schema.corpus.graphPath);
    artifacts.add(config.schema.corpus.mapPath);
  }
  for (const claim of pluginClaims) artifacts.add(claim.pathname);

  /** @type {string[]} */
  const patterns = [];
  for (const pathname of artifacts) {
    // Astro decodes concrete request pathnames before applying its generated
    // route regex. Inject the decoded identity while retaining the canonical
    // encoded spelling everywhere that is public or persisted.
    const decoded = exactPathnameIdentity(pathname, 'runtime artifact pathname').key;
    // The project already routes this exact path. Injecting a second route for it
    // makes Astro warn that a static route is defined twice, and the duplicate can
    // win the match and answer the fallback's 404 in place of the project's page.
    // The page file carries the decoded spelling, which is why this reads the key.
    if (projectRoutesExactPathname(pagesDir, decoded)) continue;
    patterns.push(
      decoded
        // Brackets are Astro's dynamic-route syntax. Its parser recognizes their
        // encoded spelling as literal brackets while still decoding ordinary URL
        // bytes before matching the generated regex.
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D'),
    );
  }

  if (mode === 'locale' || mode === 'both' || mode === 'auto') {
    if (config.corpus.index.enabled) patterns.push('/[astroAeoLocale]/llms.txt');
    if (config.corpus.full.enabled) patterns.push('/[astroAeoLocale]/llms-full.txt');
    if (config.corpus.small.enabled) patterns.push('/[astroAeoLocale]/llms-small.txt');
  }
  if (config.corpus.chunks.enabled) {
    if (topology.root) patterns.push('/llms/[astroAeoChunk].txt');
    if (topology.locale) patterns.push('/[astroAeoLocale]/llms/[astroAeoChunk].txt');
  }
  if (mode === 'both') {
    if (config.corpus.index.enabled) patterns.push('/llms-[astroAeoAlias].txt');
    if (config.corpus.full.enabled) patterns.push('/llms-full-[astroAeoAlias].txt');
    if (config.corpus.small.enabled) patterns.push('/llms-small-[astroAeoAlias].txt');
  }

  for (const pattern of patterns) {
    injectRoute({
      pattern,
      entrypoint: FALLBACK_ENTRYPOINT,
      prerender: prerenderExactPaths && !pattern.includes('['),
    });
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

/**
 * Astro's file-based routing drops the module extension, so `/llms.txt` comes from
 * `src/pages/llms.txt` plus any supported page or endpoint extension.
 * @type {readonly string[]}
 */
const PROJECT_ROUTE_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
  '.astro', '.md', '.mdx', '.markdown', '.html',
];

/**
 * Whether the project already routes this exact artifact pathname itself.
 *
 * Astro warns that a static route cannot be defined more than once and says it will
 * become a hard error. The injected fallback exists only to reach pre-middleware for
 * a path nothing else answers, so it stands down where the project routes the path.
 * `injectRoute` is exposed only in `astro:config:setup`, before any route is
 * resolved, so this asks the filesystem about a handful of exact filenames rather
 * than crawling the pages directory to discover routes.
 *
 * @param {string} pagesDir absolute pages directory
 * @param {string} pathname decoded artifact pathname, leading slash
 * @returns {boolean}
 */
function projectRoutesExactPathname(pagesDir, pathname) {
  if (!pagesDir) return false;
  const relativePath = pathname.replace(/^\/+/, '');
  if (relativePath === '') return false;
  const candidate = resolve(pagesDir, relativePath);
  const fromPages = relative(pagesDir, candidate);
  if (fromPages === '' || fromPages.startsWith('..') || isAbsolute(fromPages)) return false;
  // `llms.txt.js` and `llms.txt/index.js` both route to `/llms.txt`.
  return [candidate, resolve(candidate, 'index')].some((routeBase) =>
    PROJECT_ROUTE_EXTENSIONS.some((extension) => {
      try {
        const stats = lstatSync(`${routeBase}${extension}`);
        return stats.isFile() || stats.isSymbolicLink();
      } catch {
        return false;
      }
    }));
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
 * @param {() => { routePaths: Set<string>; routeMatchers: { pattern: RegExp; prerendered: boolean }[]; publicDir: URL | undefined; runtimeUrls?: Iterable<string> }} collisionInputs
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
