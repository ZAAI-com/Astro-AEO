// @ts-check
import { collectPages } from '../build/collect.js';
import { createArtifactWriter } from '../build/artifacts.js';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { stripSourceMarkers } from '../build/strip-markers.js';
import {
  importCatalogModule,
  loadCatalogPages,
  mergeCatalogPages,
  resolveCatalogSpecifier,
} from '../build/catalogs.js';
import { resolveSiteMeta } from '../config.js';
import { emitDotMd } from '../generators/dotmd.js';
import { stageCorpusArtifacts } from '../build/corpus.js';
import { emitDomainProfile } from '../generators/domain-profile.js';
import { emitUrlMap } from '../generators/url-map.js';
import {
  diagnosticsManifestPath,
  serializeDiagnosticsManifest,
  writeDiagnosticsManifest,
} from '../build/diagnostics.js';
import { openProcessingCache } from '../build/processing-cache.js';
import {
  INDEXNOW_PUBLIC_PATH,
  collectIndexNowFingerprints,
  ensureIndexNowPrivateDirectory,
  indexNowStatePathname,
  readIndexNowPrivateState,
} from '../build/indexnow.js';
import {
  prepareIndexNowQueue,
  serializeIndexNowAcknowledgment,
  serializeIndexNowPrepareInput,
  serializeIndexNowQueue,
  serializeIndexNowStateManifest,
} from '../build/indexnow-state.js';
import { normalizePageAlternates, resolvePageLocale } from '../core/locale.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';
import { renderSchemaCorpus, validateCollectedSchemaGraphs } from '../core/schema-corpus.js';
import { siteScopeUrl, stableCanonical } from '../core/canonical.js';
import { enrichHtmlHead, stripAeoHeadMarkers } from '../core/head.js';
import { catalogBreadcrumbTrail } from '../core/catalog-breadcrumbs.js';
import {
  applySemanticGraphPatch,
  reconcileSemanticEnvelope,
  removeManagedGraph,
  sameSemanticEntities,
} from '../core/semantic-envelope.js';
import {
  isExtractionEnvelope,
  isGraphEnvelope,
  isPageDescriptor,
  isPageMetadata,
  isPageRecord,
} from './plugin-validation.js';

/**
 * @typedef {object} BuildEnv
 * @property {string} siteUrl
 * @property {string} base
 * @property {'always'|'never'|'ignore'} trailingSlash
 * @property {'directory'|'file'} buildFormat
 * @property {string} projectRoot
 * @property {Map<string, string>} routeEntrypoints
 * @property {Set<string>} [resolvedRoutePaths]  Concrete route pathnames, for collision checks.
 * @property {{ pattern: RegExp; prerendered: boolean }[]} [resolvedRouteMatchers]
 *   Dynamic project routes, for collision checks.
 * @property {URL} [publicDir]                   Astro's publicDir, for collision checks.
 * @property {import('../index.js').Diagnostic[]} [diagnostics]
 * @property {boolean} [runtimeCorpora]            Leave corpus paths to middleware.
 * @property {{ module: string; specifier: string; namespace: any }[]} [catalogModules]
 * @property {import('../core/markdown-renderers.js').MarkdownRendererEntry[]} [markdownRenderers]
 * @property {Awaited<ReturnType<typeof import('../plugins/dispatcher.js').createPluginDispatcher>>} [pluginDispatcher]
 * @property {import('../core/locale.js').LocaleSnapshot} [i18n]
 * @property {import('../index.js').CorpusTokenizerModule} [corpusTokenizer]
 */

/**
 * Orchestrate all build-time outputs.
 *
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {{ dir: URL; pages: { pathname: string }[]; logger: { info: (m: string) => void; warn: (m: string) => void } }} options
 * @param {BuildEnv} env
 */
export async function onBuildDone(config, options, env) {
  const { dir, pages: rawPages, logger } = options;
  const buildDiagnostics = env.diagnostics ?? (env.diagnostics = []);
  const buildStarted = Date.now();
  const processingCache = openProcessingCache(env.projectRoot, {
    enabled: config.cache?.enabled !== false,
    diagnostics: buildDiagnostics,
    logger,
  });
  const indexNowPrivate = config.discovery.indexNow.enabled
    ? readIndexNowPrivateState(env.projectRoot)
    : undefined;
  if (indexNowPrivate) buildDiagnostics.push(...indexNowPrivate.diagnostics);

  // Routes generated from data are invisible to Astro's own page list, so a
  // catalog is the only way they can appear in the corpus.
  const catalogModules = env.catalogModules;
  const buildCatalogs = catalogModules
    ? catalogModules.map(({ module }) => ({ module }))
    : config.pages.catalogs;
  const loadedCatalogPages = buildCatalogs.length
    ? await loadCatalogPages(
        buildCatalogs,
        (/** @type {string} */ module) => {
          const preloaded = catalogModules?.find((candidate) => candidate.module === module);
          return preloaded
            ? Promise.resolve(preloaded.namespace)
            : importCatalogModule(resolveCatalogSpecifier(module, env.projectRoot));
        },
        logger,
        {
          command: 'build',
          siteUrl: env.siteUrl,
          base: env.base,
          trailingSlash: env.trailingSlash,
        },
        env.diagnostics ?? [],
      )
    : [];
  const catalogPages = loadedCatalogPages.filter((page) => {
    if (!isOwnedArtifactPath(page.pathname, config)) return true;
    env.diagnostics?.push({
      version: 1,
      code: 'catalog-owned-artifact-excluded',
      severity: 'warning',
      message: `Catalog page ${page.pathname} was excluded because Astro-AEO owns that artifact path.`,
      pathname: page.pathname,
      ...(page.sourcePath ? { sourcePath: page.sourcePath } : {}),
    });
    return false;
  });
  if (catalogPages.length) {
    logger.info(`astro-aeo: ${catalogPages.length} page(s) contributed by catalogs`);
  }

  let pageDescriptors = mergeCatalogPages(rawPages, catalogPages);
  // Marker removal covers every concrete page Astro reported, including a page
  // a discovered hook later isolates before collection. The marker payload is
  // private transport and must never depend on lifecycle eligibility.
  const markerDescriptors = [...pageDescriptors];
  if (env.pluginDispatcher) {
    const discovered = [];
    for (const descriptor of pageDescriptors) {
      const result = await env.pluginDispatcher.run('page:discovered', descriptor, {
        pathname: descriptor.pathname,
        mode: 'build',
        validate: (value) => isPageDescriptor(value) && value.pathname === descriptor.pathname,
      });
      env.diagnostics?.push(...result.diagnostics);
      if (!result.isolated) discovered.push(result.value);
    }
    pageDescriptors = discovered;
  }
  let pages = await collectPages(pageDescriptors, config, {
    distDir: dir,
    siteUrl: env.siteUrl,
    base: env.base,
    trailingSlash: env.trailingSlash,
    buildFormat: env.buildFormat,
    projectRoot: env.projectRoot,
    routeEntrypoints: env.routeEntrypoints,
    logger,
    renderers: env.markdownRenderers,
    cache: processingCache,
  });

  if (env.pluginDispatcher) {
    const processed = [];
    for (const original of pages) {
      const extracted = await env.pluginDispatcher.run('page:extract', {
        representations: original.representations,
        extraction: original.extraction ?? null,
        source: original.source,
      }, {
        pathname: original.pathname,
        mode: 'build',
        validate: isExtractionEnvelope,
      });
      env.diagnostics?.push(...extracted.diagnostics);
      if (extracted.isolated) continue;
      let page = {
        ...original,
        ...('representations' in extracted.value ? { representations: extracted.value.representations } : {}),
        ...('extraction' in extracted.value ? { extraction: extracted.value.extraction ?? undefined } : {}),
        ...('source' in extracted.value ? { source: extracted.value.source ?? undefined } : {}),
      };
      page.markdown = page.representations.markdown ?? '';
      const { htmlPath: _htmlPath, mdPath: _mdPath, ...publicPage } = page;
      const transformed = await env.pluginDispatcher.run('page:transform', publicPage, {
        pathname: page.pathname,
        mode: 'build',
        validate: (value) => isPageRecord(value) && value.id === page.id && value.pathname === page.pathname,
      });
      env.diagnostics?.push(...transformed.diagnostics);
      if (transformed.isolated) continue;
      page = {
        ...original,
        ...transformed.value,
        markdown: transformed.value.representations.markdown ?? '',
      };
      const metadata = await env.pluginDispatcher.run('page:metadata', page.metadata, {
        pathname: page.pathname,
        mode: 'build',
        validate: isPageMetadata,
      });
      env.diagnostics?.push(...metadata.diagnostics);
      if (metadata.isolated) continue;
      processed.push({ ...page, metadata: metadata.value, title: metadata.value.title, description: metadata.value.description ?? '' });
    }
    pages = processed;
  }

  const home = pages.find((p) => p.pathname === '/');
  const { name: siteName, description: siteDescription } = resolveSiteMeta(
    config,
    env.siteUrl,
    home?.title ?? '',
  );

  // One writer for the whole build, so it can see every claim and report a
  // collision between two generators, a project route, or a public/ file.
  const writer = createArtifactWriter({
    distDir: dir,
    logger,
    routePaths: env.resolvedRoutePaths,
    routeMatchers: env.resolvedRouteMatchers,
    publicDir: env.publicDir,
    deferred: true,
    projectRoot: env.projectRoot,
    base: env.base,
    replacePaths: config.artifacts?.replace ?? [],
    diagnostics: env.diagnostics ?? [],
    failOn: config.validation?.failOn ?? 'error',
    validationOnBuild: config.validation?.onBuild ?? 'artifacts',
    diagnosticsProvider: () => pages.flatMap((page) => page.diagnostics),
    onDiagnostics: () => writeDiagnosticsManifest(env.projectRoot, pages, env.diagnostics ?? []),
    onSettled: () => processingCache.close(),
  });
  /** @type {any} */ (writer).stagePrivateWrite?.(
    diagnosticsManifestPath(env.projectRoot),
    () => serializeDiagnosticsManifest(pages, env.diagnostics ?? []),
    { mode: 0o600, confineTo: env.projectRoot },
  );

  /** @type {{ page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph }[]} */
  const semanticPages = [];
  if (env.pluginDispatcher) {
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const { htmlPath: _htmlPath, mdPath: _mdPath, ...publicPage } = page;
      // Astro exposes prerendered status pages as ordinary build pages. They
      // remain eligible for an explicit AeoHead decision, but must never gain
      // the default graph merely because they contain successful HTML bytes.
      const allowGlobal = page.pathname !== '/404' && page.pathname !== '/500';
      const semanticSite = {
        siteUrl: env.siteUrl,
        base: env.base,
        trailingSlash: env.trailingSlash,
      };
      const breadcrumbTrail = catalogBreadcrumbTrail(
        page.pathname,
        catalogPages,
        semanticSite,
      );
      const initial = {
        html: page.representations.html ?? '',
        page: publicPage,
        site: semanticSite,
        allowGlobal,
        breadcrumbTrail,
        graph: null,
        explicit: false,
      };
      const internalBaseline = enrichHtmlHead({
        html: initial.html,
        page: publicPage,
        config,
        site: semanticSite,
        allowGlobal,
        breadcrumbTrail,
      });
      const authoredBaseline = enrichHtmlHead({
        html: initial.html,
        page: publicPage,
        config,
        site: semanticSite,
        allowGlobal,
        inspectAuthored: true,
        breadcrumbTrail,
      });
      const baseline = {
        ...internalBaseline,
        authoredGraph: authoredBaseline.authoredGraph,
      };
      const semantic = await env.pluginDispatcher.run('graph:build', initial, {
        pathname: page.pathname,
        mode: 'build',
        validate: (value) => isGraphEnvelope(value, {
          id: page.id,
          pathname: page.pathname,
          site: semanticSite,
        }),
      });
      const semanticDiagnostics = uniqueBuildDiagnostics([
        ...semantic.diagnostics,
        ...authoredBaseline.diagnostics,
      ]);
      env.diagnostics?.push(...semanticDiagnostics);
      if (semantic.isolated) {
        pages[index] = { ...page, diagnostics: [...page.diagnostics, ...semanticDiagnostics] };
        if (page.htmlPath) writer.stageTransform(page.htmlPath, 'head-marker-redaction', stripAeoHeadMarkers);
        continue;
      }
      const reconciled = reconcileSemanticEnvelope({
        baseline,
        value: /** @type {any} */ (semantic.value),
        siteUrl: siteScopeUrl(env.siteUrl, env.base),
        strictReferences: config.schema.strictReferences,
        pathname: page.pathname,
      });
      if (!reconciled.valid) {
        buildDiagnostics.push(...reconciled.diagnostics);
        pages[index] = {
          ...page,
          diagnostics: [...page.diagnostics, ...semanticDiagnostics, ...reconciled.diagnostics],
        };
        if (page.htmlPath) writer.stageTransform(page.htmlPath, 'head-marker-redaction', stripAeoHeadMarkers);
        continue;
      }
      const value = reconciled.value;
      buildDiagnostics.push(...reconciled.diagnostics);
      const candidate = isPageRecord(value.page) ? value.page : page;
      const enrichedHtml = typeof value.html === 'string' ? value.html : stripAeoHeadMarkers(initial.html);
      const enrichedPage = {
        ...candidate,
        representations: { ...candidate.representations, html: enrichedHtml },
        diagnostics: [
          ...candidate.diagnostics,
          ...semanticDiagnostics,
          ...reconciled.diagnostics,
        ],
      };
      const corpusGraph = value.normalizedGraph?.entries ? value.normalizedGraph : value.graph;
      if (corpusGraph?.entries) {
        enrichedPage.entities = corpusGraph.entries.map((/** @type {any} */ entry) => entry.entity);
        semanticPages.push({ page: enrichedPage, graph: corpusGraph });
      }
      pages[index] = /** @type {typeof page} */ ({ ...page, ...enrichedPage });
      if (page.htmlPath) {
        /** @param {import('../schema.js').AeoGraph | null | undefined} refreshedGraph */
        const assertStaticCorpusStable = (refreshedGraph) => {
          if (
            !config.schema.corpus.enabled ||
            env.runtimeCorpora ||
            sameSemanticEntities(
              refreshedGraph?.entries ? refreshedGraph : null,
              corpusGraph?.entries ? corpusGraph : null,
            )
          ) return;
          if (!buildDiagnostics.some((diagnostic) =>
            diagnostic.code === 'schema-corpus-late-semantic-change' &&
            diagnostic.pathname === page.pathname)) {
            buildDiagnostics.push({
              version: 1,
              code: 'schema-corpus-late-semantic-change',
              severity: 'error',
              message: 'A page semantic graph changed after the static schema corpus was collected; the artifact transaction was aborted.',
              pathname: page.pathname,
            });
          }
          throw new SemanticTransformConflictError();
        };
        writer.stageTransform(page.htmlPath, 'semantic-head', (html) => {
          const refreshedInternal = enrichHtmlHead({
            html,
            page: publicPage,
            config,
            site: semanticSite,
            allowGlobal,
            breadcrumbTrail,
          });
          if (!env.pluginDispatcher?.hasUserHooks('graph:build')) {
            assertStaticCorpusStable(refreshedInternal.normalizedGraph ?? refreshedInternal.graph);
            return refreshedInternal.html;
          }

          const refreshedAuthored = enrichHtmlHead({
            html,
            page: publicPage,
            config,
            site: semanticSite,
            allowGlobal,
            inspectAuthored: true,
            breadcrumbTrail,
          });
          const refreshedBaseline = {
            ...refreshedInternal,
            authoredGraph: refreshedAuthored.authoredGraph,
          };

          // User graph hooks already ran once at the public lifecycle boundary.
          // Reapply only their non-managed HTML delta, then regenerate managed
          // JSON-LD against the latest authored graph and HTML bytes.
          try {
            const pluginHtml = applyHtmlDelta(
              removeManagedGraph(refreshedInternal.html),
              removeManagedGraph(baseline.html),
              removeManagedGraph(enrichedHtml),
            );
            const replayed = applySemanticGraphPatch(
              refreshedInternal.graph,
              reconciled.changes.managedPatch,
            );
            if (!replayed.valid) {
              if (!buildDiagnostics.some((diagnostic) =>
                diagnostic.code === 'plugin-graph-inconsistent' &&
                diagnostic.pathname === page.pathname)) {
                buildDiagnostics.push({
                  version: 1,
                  code: 'plugin-graph-inconsistent',
                  severity: 'error',
                  message: 'A graph plugin change conflicted with semantic facts added later in the build.',
                  pathname: page.pathname,
                });
              }
              throw new SemanticTransformConflictError();
            }
            const finalized = reconcileSemanticEnvelope({
              baseline: refreshedBaseline,
              value: {
                ...value,
                html: pluginHtml,
                graph: replayed.graph,
                normalizedGraph: refreshedInternal.normalizedGraph,
              },
              siteUrl: siteScopeUrl(env.siteUrl, env.base),
              strictReferences: config.schema.strictReferences,
              pathname: page.pathname,
            });
            if (!finalized.valid) {
              for (const diagnostic of finalized.diagnostics) {
                if (!buildDiagnostics.some((current) =>
                  current.code === diagnostic.code && current.pathname === diagnostic.pathname)) {
                  buildDiagnostics.push(diagnostic);
                }
              }
              throw new SemanticTransformConflictError();
            }
            const refreshedCorpusGraph = finalized.value.normalizedGraph?.entries
              ? finalized.value.normalizedGraph
              : finalized.value.graph;
            assertStaticCorpusStable(refreshedCorpusGraph);
            return finalized.value.html;
          } catch (error) {
            if (error instanceof HtmlDeltaConflictError && !buildDiagnostics.some(
              (diagnostic) =>
                diagnostic.code === 'plugin-html-delta-conflict' &&
                diagnostic.pathname === page.pathname,
            )) {
              buildDiagnostics.push({
                version: 1,
                code: 'plugin-html-delta-conflict',
                severity: 'error',
                message: 'A plugin HTML replacement could not be reapplied safely after the page changed; the artifact transaction was aborted.',
                pathname: page.pathname,
              });
            }
            throw error;
          }
        });
      }
    }
  }

  let localizedPages = pages.map((page) => {
    const result = resolvePageLocale(page, env.i18n ?? {
      locales: [],
      origins: env.siteUrl ? [env.siteUrl] : [],
      ...(env.siteUrl ? { primaryOrigin: env.siteUrl } : {}),
      prefixDefaultLocale: false,
      manual: false,
    }, {
      unresolvedLanguage: config.i18n?.unresolvedLanguage ?? 'default',
      siteDefaultLocale: config.site.defaultLocale,
    });
    buildDiagnostics.push(...result.diagnostics);
    return result.excluded ? { ...result.page, corpusExcluded: true } : result.page;
  });
  // Preserve the ordinary pre-i18n project shape when one rendered language
  // is present and catalog pages carry no language declaration. The sole
  // observed language is the deterministic project default for this build.
  if ((env.i18n?.locales.length ?? 0) === 0) {
    const concrete = [...new Set(localizedPages.flatMap((page) =>
      !page.corpusExcluded && page.language && page.locale ? [page.language] : [],
    ))];
    if (concrete.length === 1) {
      localizedPages = localizedPages.map((page) => page.corpusExcluded || page.locale != null
        ? page
        : { ...page, locale: concrete[0], language: concrete[0] });
    }
  }
  const alternates = normalizePageAlternates(localizedPages);
  buildDiagnostics.push(...alternates.diagnostics);
  pages = alternates.pages;
  if (
    (config.i18n?.indexes === 'locale' || config.i18n?.indexes === 'both') &&
    pages.some((page) => !page.corpusExcluded && page.locale == null)
  ) {
    buildDiagnostics.push({
      version: 1,
      code: 'corpus-locale-required',
      severity: 'error',
      message: `i18n.indexes "${config.i18n.indexes}" requires every corpus page to resolve to a concrete locale.`,
    });
    pages = pages.map((page) => page.locale == null ? { ...page, corpusExcluded: true } : page);
  }

  if (!config.schema.corpus.enabled && semanticPages.length > 0) {
    const stableSite = stableCanonical(env.siteUrl);
    if (stableSite) {
      env.diagnostics?.push(...validateCollectedSchemaGraphs(semanticPages, {
        siteUrl: siteScopeUrl(stableSite, env.base) ?? stableSite,
        strictReferences: config.schema.strictReferences,
      }));
    }
  }

  if (config.schema.corpus.enabled && !env.runtimeCorpora) {
    const stableSite = stableCanonical(env.siteUrl);
    if (!stableSite) {
      env.diagnostics?.push({
        version: 1,
        code: 'schema-corpus-canonical-missing',
        severity: 'error',
        message: 'The schema corpus requires a configured stable Astro site URL.',
      });
    } else {
      try {
        const graphPath = `${env.base || ''}${config.schema.corpus.graphPath}`;
        const scopeUrl = siteScopeUrl(stableSite, env.base) ?? stableSite;
        const corpus = renderSchemaCorpus(semanticPages, {
          graphUrl: new URL(graphPath, stableSite).href,
          siteUrl: scopeUrl,
          strictReferences: config.schema.strictReferences,
        });
        env.diagnostics?.push(...corpus.diagnostics);
        writer.write({
          route: config.schema.corpus.graphPath,
          owner: { kind: 'core', name: 'schemaGraph' },
          representation: corpus.graph,
          group: 'astro-aeo/schema-corpus',
        });
        writer.write({
          route: config.schema.corpus.mapPath,
          owner: { kind: 'core', name: 'schemaMap' },
          representation: corpus.map,
          group: 'astro-aeo/schema-corpus',
        });
      } catch (error) {
        const findings = /** @type {any} */ (error)?.result?.findings;
        if (Array.isArray(findings) && findings.length > 0) {
          env.diagnostics?.push(...findings.map((finding) => ({
            version: /** @type {const} */ (1),
            code: typeof finding.code === 'string' ? finding.code : 'schema-corpus-invalid',
            severity: finding.severity === 'warning' || finding.severity === 'info'
              ? finding.severity
              : /** @type {const} */ ('error'),
            message: typeof finding.message === 'string'
              ? finding.message
              : 'The semantic corpus pair failed cross-page validation and was omitted.',
          })));
        } else {
          env.diagnostics?.push({
            version: 1,
            code: 'schema-corpus-invalid',
            severity: 'error',
            message: 'The semantic corpus pair failed cross-page validation and was omitted.',
          });
        }
      }
    }
  } else if (config.schema.corpus.enabled) {
    writer.write({
      route: config.schema.corpus.graphPath,
      owner: { kind: 'core', name: 'schemaGraph' },
      runtime: true,
      group: 'astro-aeo/schema-corpus',
    });
    writer.write({
      route: config.schema.corpus.mapPath,
      owner: { kind: 'core', name: 'schemaMap' },
      runtime: true,
      group: 'astro-aeo/schema-corpus',
    });
  }

  if (env.pluginDispatcher) {
    await emitPluginArtifacts(
      env.pluginDispatcher,
      pages,
      writer,
      env.diagnostics ?? [],
      Boolean(env.runtimeCorpora),
    );
  }

  const written = emitDotMd(pages, config, writer);
  if (config.markdown.enabled) logger.info(`astro-aeo: emitted ${written} .md companion files`);

  const corpus = await stageCorpusArtifacts(pages, config, {
    siteUrl: env.siteUrl,
    base: env.base,
    siteMeta: { name: siteName, description: siteDescription },
    writer,
    runtime: Boolean(env.runtimeCorpora),
    tokenizer: env.corpusTokenizer,
    i18n: env.i18n,
    diagnostics: buildDiagnostics,
  });
  if (corpus.artifacts.length > 0) {
    logger.info(
      env.runtimeCorpora
        ? 'astro-aeo: request-time middleware owns the configured corpus paths'
        : `astro-aeo: planned ${corpus.artifacts.length} corpus artifact(s)`,
    );
  }

  emitDomainProfile(dir, config, env.siteUrl, writer);
  if (config.site.profile.enabled) logger.info('astro-aeo: emitted /.well-known/domain-profile.json');

  // Unconditional, and last, so it also covers pages every generator skipped.
  const stripped = stripSourceMarkers(
    markerDescriptors,
    createDistHtmlSource({ distDir: dir, buildFormat: env.buildFormat }),
    writer,
  );
  if (stripped) logger.info(`astro-aeo: removed the source marker from ${stripped} page(s)`);

  // The URL map lives under the project root rather than dist, but remains an
  // owned artifact and must participate in cross-generator collision checks.
  if (config.corpus.urlMap.enabled) {
    const urlMapWritten = emitUrlMap(pages, config, env.projectRoot, new Date(), writer);
    if (urlMapWritten) {
      logger.info(`astro-aeo: emitted ${config.corpus.urlMap.outputFilepath}`);
    }
  }

  if (config.discovery.indexNow.enabled && indexNowPrivate) {
    stageIndexNowBuild({
      config,
      env,
      pages,
      semanticPages,
      writer,
      privateState: indexNowPrivate,
      processingReadOnly: processingCache.readOnly,
      diagnostics: buildDiagnostics,
    });
  }

  if (env.pluginDispatcher) {
    await runBuildComplete(env.pluginDispatcher, pages, env.diagnostics ?? []);
  }

  processingCache.stage(/** @type {any} */ (writer));
  // Keep diagnostics observable for integrations and test harnesses that call
  // only the primary build hook. The late finalizer writes the same sanitized
  // payload again inside the artifact transaction for normal Astro builds.
  writeDiagnosticsManifest(env.projectRoot, pages, env.diagnostics ?? []);
  logger.info(
    `astro-aeo: processing cache ${processingCache.stats.hits} hit(s), ` +
      `${processingCache.stats.misses} miss(es), ${Date.now() - buildStarted}ms collection time`,
  );

  return writer;
}

/**
 * Stage IndexNow public and private state without resolving a secret or sending
 * a request. Every byte joins the same deferred transaction as build artifacts.
 * @param {{
 *   config: import('../index.js').ResolvedAstroAeoConfig;
 *   env: BuildEnv;
 *   pages: import('../core/page-model.js').AeoPageRecord[];
 *   semanticPages: { page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph }[];
 *   writer: ReturnType<typeof createArtifactWriter>;
 *   privateState: ReturnType<typeof readIndexNowPrivateState>;
 *   processingReadOnly: boolean;
 *   diagnostics: import('../index.js').Diagnostic[];
 * }} options
 */
function stageIndexNowBuild(options) {
  const { config, env, writer, privateState, processingReadOnly, diagnostics } = options;
  let primaryOrigin;
  try { primaryOrigin = normalizeIndexNowOrigin(env.siteUrl); }
  catch {
    diagnostics.push({
      version: 1,
      code: 'indexnow-site-required',
      severity: 'error',
      message: 'IndexNow requires Astro site to be a public HTTPS origin.',
    });
    return;
  }

  const readOnly = processingReadOnly || privateState.readOnly;
  /** @type {import('../build/indexnow-state.js').IndexNowAcknowledgmentV1} */
  const priorAck = readOnly ? { version: 1, origins: [] } : privateState.acknowledgment;
  /** @type {import('../build/indexnow-state.js').IndexNowQueueV1} */
  const priorQueue = readOnly ? { version: 1, origins: [] } : privateState.queue;
  const stateMode = config.discovery.indexNow.state;
  const configuredOrigins = new Set([primaryOrigin]);
  if (stateMode !== 'public') {
    for (const value of env.i18n?.origins ?? []) {
      try { configuredOrigins.add(normalizeIndexNowOrigin(value)); } catch {}
    }
    for (const value of config.discovery.indexNow.origins) configuredOrigins.add(value.origin);
  }
  const eligiblePages = stateMode === 'public'
    ? options.pages.filter((page) => {
        try { return new URL(page.canonicalUrl ?? page.url).origin === primaryOrigin; }
        catch { return true; }
      })
    : options.pages;
  const semanticGraphs = new Map(options.semanticPages.map((entry) => [
    `${entry.page.origin ?? primaryOrigin}\u0000${entry.page.id}`,
    entry.graph,
  ]));
  const acknowledged = priorAck.origins
    .filter((item) => configuredOrigins.has(item.origin))
    .flatMap((item) => item.acknowledged);
  const fingerprints = collectIndexNowFingerprints(eligiblePages, {
    acknowledged,
    origins: configuredOrigins,
    graphFor(page) {
      return semanticGraphs.get(`${page.origin ?? primaryOrigin}\u0000${page.id}`) ?? null;
    },
  });
  diagnostics.push(...fingerprints.diagnostics);

  const originOverrides = config.discovery.indexNow.origins
    .filter((item) => stateMode !== 'public' || item.origin === primaryOrigin)
    .map((item) => ({ ...item }));
  if (!originOverrides.some((item) => item.origin === primaryOrigin)) {
    originOverrides.push({ origin: primaryOrigin });
  }
  const input = {
    version: /** @type {const} */ (1),
    projectRoot: env.projectRoot,
    mode: stateMode,
    submit: config.discovery.indexNow.submit,
    strict: config.discovery.indexNow.strict,
    base: env.base,
    statePathname: indexNowStatePathname(env.base),
    key: config.discovery.indexNow.key,
    ...(config.discovery.indexNow.keyLocation
      ? { keyLocation: config.discovery.indexNow.keyLocation }
      : {}),
    origins: originOverrides,
    current: fingerprints.current,
  };
  const prepared = prepareIndexNowQueue(input, {
    acknowledgment: {
      version: 1,
      origins: priorAck.origins.filter((item) => configuredOrigins.has(item.origin)),
    },
    priorQueue: {
      version: 1,
      origins: priorQueue.origins.filter((item) => configuredOrigins.has(item.origin)),
    },
  });
  for (const warning of prepared.warnings) diagnostics.push({
    version: 1,
    code: 'indexnow-state-mode-adjusted',
    severity: 'warning',
    message: warning,
  });

  let publicAccepted = true;
  if (stateMode === 'public') {
    const manifest = prepared.manifests.find((item) => item.origin === primaryOrigin);
    if (!manifest) {
      diagnostics.push({
        version: 1,
        code: 'indexnow-state-unavailable',
        severity: 'error',
        message: 'IndexNow could not create a host-local public state manifest.',
      });
      return;
    }
    writer.write({
      route: INDEXNOW_PUBLIC_PATH,
      owner: { kind: 'core', name: 'indexNowState' },
      representation: {
        body: serializeIndexNowStateManifest(manifest),
        contentType: 'application/json; charset=utf-8',
      },
    });
    const deployedPath = indexNowStatePathname(env.base);
    const preview = /** @type {any} */ (writer).preview?.();
    publicAccepted = Boolean(preview?.manifestEntries?.some((/** @type {any} */ entry) =>
      entry.pathname === deployedPath && entry.status === 'emitted'
    ));
    if (!publicAccepted) {
      diagnostics.push({
        version: 1,
        code: 'indexnow-state-unavailable',
        severity: 'error',
        message: 'The public IndexNow state path is owned by the project or another artifact; notification state was not advanced.',
        pathname: deployedPath,
      });
    }
  }

  if (!publicAccepted || readOnly) {
    if (readOnly) diagnostics.push({
      version: 1,
      code: 'indexnow-state-read-only',
      severity: 'warning',
      message: 'IndexNow state preparation is read-only because reusable build state is locked or invalid.',
    });
    return;
  }

  try { ensureIndexNowPrivateDirectory(env.projectRoot); }
  catch {
    diagnostics.push({
      version: 1,
      code: 'indexnow-state-unavailable',
      severity: 'error',
      message: 'The private IndexNow state directory could not be prepared safely.',
    });
    return;
  }
  const targets = new Map(prepared.manifests.map((item) => [item.origin, item.digest]));
  const stagedInput = {
    ...input,
    origins: input.origins.map((item) => ({
      ...item,
      ...(targets.get(item.origin) ? { targetDigest: targets.get(item.origin) } : {}),
    })),
  };
  const deferred = /** @type {any} */ (writer);
  deferred.stagePrivateWrite(
    privateState.paths.prepareInput,
    serializeIndexNowPrepareInput(stagedInput),
    { mode: 0o600, confineTo: env.projectRoot },
  );
  deferred.stagePrivateWrite(
    privateState.paths.pending,
    serializeIndexNowQueue(prepared.queue),
    { mode: 0o600, confineTo: env.projectRoot },
  );
  deferred.stagePrivateWrite(
    privateState.paths.acknowledgment,
    serializeIndexNowAcknowledgment(prepared.acknowledgment),
    { mode: 0o600, confineTo: env.projectRoot },
  );
}

/** @param {string} value */
function normalizeIndexNowOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new TypeError('unsafe origin');
  }
  return url.origin;
}

/**
 * Reapply one already-validated plugin replacement as its smallest contiguous
 * delta. Internal head enrichment is rerun against current bytes first, so the
 * ordinary path remains fully targeted and byte-stable.
 * @param {string} current
 * @param {string} before
 * @param {string} after
 */
function applyHtmlDelta(current, before, after) {
  if (before === after) return current;
  let prefix = 0;
  const prefixLimit = Math.min(before.length, after.length);
  while (prefix < prefixLimit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;

  let suffix = 0;
  const suffixLimit = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < suffixLimit &&
    before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
  ) suffix++;

  const removed = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);
  if (!removed) {
    const right = before.slice(prefix, prefix + 80);
    if (!right) return `${current}${inserted}`;
    const at = current.indexOf(right);
    if (at === -1 || current.indexOf(right, at + right.length) !== -1) {
      throw new HtmlDeltaConflictError();
    }
    return `${current.slice(0, at)}${inserted}${current.slice(at)}`;
  }
  const first = current.indexOf(removed);
  if (first === -1 || current.indexOf(removed, first + removed.length) !== -1) {
    throw new HtmlDeltaConflictError();
  }
  return `${current.slice(0, first)}${inserted}${current.slice(first + removed.length)}`;
}

class HtmlDeltaConflictError extends Error {
  constructor() {
    super('astro-aeo: a plugin HTML replacement could not be reapplied safely after the page changed.');
    this.name = 'HtmlDeltaConflictError';
  }
}

class SemanticTransformConflictError extends Error {
  constructor() {
    super('astro-aeo: a plugin semantic replacement could not be reconciled safely after the page changed.');
    this.name = 'SemanticTransformConflictError';
  }
}

/** @param {import('../index.js').Diagnostic[]} diagnostics */
function uniqueBuildDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([
      diagnostic.version,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.pathname ?? null,
      diagnostic.sourcePath ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {unknown} value @param {{ id: string; pathname: string; replace?: boolean }} expected */
function isArtifactEnvelope(value, expected) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    candidate.claim?.id === expected.id &&
    candidate.claim?.pathname === expected.pathname &&
    candidate.claim?.replace === expected.replace &&
    candidate.representation &&
    typeof candidate.representation.body === 'string' &&
    typeof candidate.representation.contentType === 'string'
  );
}

/**
 * @param {Awaited<ReturnType<typeof import('../plugins/dispatcher.js').createPluginDispatcher>>} dispatcher
 * @param {import('../index.js').AeoPageRecord[]} pages
 * @param {ReturnType<typeof createArtifactWriter>} writer
 * @param {import('../index.js').Diagnostic[]} diagnostics
 * @param {boolean} runtimeOutput
 */
async function emitPluginArtifacts(dispatcher, pages, writer, diagnostics, runtimeOutput) {
  const safePages = pages.map((page) => ({ id: page.id, pathname: page.pathname }));
  for (const claim of dispatcher.claims) {
    const generated = await dispatcher.run('artifact:generate', {
      claim: { id: claim.id, pathname: claim.pathname, ...(claim.replace ? { replace: true } : {}) },
      pages: safePages,
      representation: null,
    }, {
      mode: 'build',
      pathname: claim.pathname,
      validate: (value) => isArtifactEnvelope(value, claim),
    });
    diagnostics.push(...generated.diagnostics);
    if (generated.isolated) continue;
    const representation = /** @type {any} */ (generated.value).representation;
    if (!representation || typeof representation.body !== 'string' || typeof representation.contentType !== 'string') {
      diagnostics.push({
        version: 1,
        code: 'plugin-artifact-missing',
        severity: 'error',
        message: `Plugin "${claim.plugin}" did not produce a valid representation for its declared artifact.`,
        pathname: claim.pathname,
      });
      continue;
    }
    const validated = await dispatcher.run('artifact:validate', {
      claim: {
        id: claim.id,
        pathname: claim.pathname,
        ...(claim.replace ? { replace: true } : {}),
      },
      representation,
    }, {
      mode: 'build',
      pathname: claim.pathname,
      validate: (value) => isArtifactEnvelope(value, claim),
    });
    diagnostics.push(...validated.diagnostics);
    if (validated.isolated) continue;
    const validatedRepresentation = /** @type {any} */ (validated.value).representation;
    const runtimeClaim = runtimeOutput && dispatcher.runtimeManifest.plugins.some((plugin) =>
      plugin.name === claim.plugin && plugin.claims.some((candidate) =>
        candidate.id === claim.id && candidate.pathname === claim.pathname,
      ),
    );
    writer.write({
      route: claim.pathname,
      owner: { kind: 'plugin', name: claim.plugin, claimId: claim.id },
      replace: claim.replace,
      representation: validatedRepresentation,
      ...(runtimeClaim ? { runtime: true } : {}),
    });
  }
}

/**
 * Run the final public lifecycle stage after every ordinary artifact candidate
 * and HTML transform has been staged, but before the ownership writer applies
 * the validation threshold and commits any enrichment.
 * @param {Awaited<ReturnType<typeof import('../plugins/dispatcher.js').createPluginDispatcher>>} dispatcher
 * @param {import('../index.js').AeoPageRecord[]} pages
 * @param {import('../index.js').Diagnostic[]} diagnostics
 */
async function runBuildComplete(dispatcher, pages, diagnostics) {
  const summary = await dispatcher.run('build:complete', {
    pages: pages.length,
    artifactPaths: dispatcher.claims.map((claim) => claim.pathname).sort(),
    diagnostics: {
      error: diagnostics.filter((item) => item.severity === 'error').length,
      warning: diagnostics.filter((item) => item.severity === 'warning').length,
      info: diagnostics.filter((item) => item.severity === 'info').length,
    },
  }, { mode: 'build' });
  diagnostics.push(...summary.diagnostics);
  if (summary.isolated) {
    diagnostics.push({
      version: 1,
      code: 'plugin-build-complete-isolated',
      severity: 'error',
      message: 'A plugin isolated the pending build during build:complete.',
    });
  }
}
