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
import { emitLlmsTxt, emitLlmsFullTxt } from '../generators/llms-txt.js';
import { emitDomainProfile } from '../generators/domain-profile.js';
import { emitUrlMap } from '../generators/url-map.js';
import { writeDiagnosticsManifest } from '../build/diagnostics.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';
import { renderSchemaCorpus } from '../core/schema-corpus.js';
import { stableCanonical } from '../core/canonical.js';
import { enrichHtmlHead, stripAeoHeadMarkers } from '../core/head.js';

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
    onDiagnostics: () =>
      writeDiagnosticsManifest(env.projectRoot, pages, env.diagnostics ?? []),
  });

  /** @type {{ page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph }[]} */
  const semanticPages = [];
  if (env.pluginDispatcher) {
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const { htmlPath: _htmlPath, mdPath: _mdPath, ...publicPage } = page;
      const initial = {
        html: page.representations.html ?? '',
        page: publicPage,
        site: { siteUrl: env.siteUrl, base: env.base, trailingSlash: env.trailingSlash },
        allowGlobal: true,
        graph: null,
        explicit: false,
      };
      const semantic = await env.pluginDispatcher.run('graph:build', initial, {
        pathname: page.pathname,
        mode: 'build',
        validate: isGraphEnvelope,
      });
      env.diagnostics?.push(...semantic.diagnostics);
      if (semantic.isolated) {
        pages[index] = { ...page, diagnostics: [...page.diagnostics, ...semantic.diagnostics] };
        if (page.htmlPath) writer.stageTransform(page.htmlPath, 'head-marker-redaction', stripAeoHeadMarkers);
        continue;
      }
      const value = /** @type {any} */ (semantic.value);
      const candidate = isPageRecord(value.page) ? value.page : page;
      const enrichedHtml = typeof value.html === 'string' ? value.html : stripAeoHeadMarkers(initial.html);
      const enrichedPage = {
        ...candidate,
        representations: { ...candidate.representations, html: enrichedHtml },
        diagnostics: [...candidate.diagnostics, ...semantic.diagnostics],
      };
      const corpusGraph = value.normalizedGraph?.entries ? value.normalizedGraph : value.graph;
      if (corpusGraph?.entries) {
        enrichedPage.entities = corpusGraph.entries.map((/** @type {any} */ entry) => entry.entity);
        semanticPages.push({ page: enrichedPage, graph: corpusGraph });
      }
      pages[index] = /** @type {typeof page} */ ({ ...page, ...enrichedPage });
      if (page.htmlPath) {
        writer.stageTransform(page.htmlPath, 'semantic-head', (html) => {
          const refreshed = enrichHtmlHead({
            html,
            page: publicPage,
            config,
            site: { siteUrl: env.siteUrl, base: env.base, trailingSlash: env.trailingSlash },
            allowGlobal: true,
          }).html;
          if (!env.pluginDispatcher?.hasUserHooks('graph:build')) return refreshed;

          // User graph hooks already ran once at the public lifecycle boundary.
          // Reapply only their delta to the freshly enriched bytes so a later
          // integration's unrelated HTML edits are retained.
          const internalHtml = enrichHtmlHead({
            html: initial.html,
            page: publicPage,
            config,
            site: { siteUrl: env.siteUrl, base: env.base, trailingSlash: env.trailingSlash },
            allowGlobal: true,
          }).html;
          return applyHtmlDelta(refreshed, internalHtml, enrichedHtml);
        });
      }
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
        const corpus = renderSchemaCorpus(semanticPages, {
          graphUrl: new URL(graphPath, stableSite).href,
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
  }

  if (env.pluginDispatcher) {
    await emitPluginArtifacts(env.pluginDispatcher, pages, writer, env.diagnostics ?? []);
  }

  const written = emitDotMd(pages, config, writer);
  if (config.markdown.enabled) logger.info(`astro-aeo: emitted ${written} .md companion files`);

  if (!env.runtimeCorpora) {
    emitLlmsTxt(pages, dir, config, siteName, siteDescription, writer);
    emitLlmsFullTxt(pages, dir, config, siteName, siteDescription, writer);
    if (config.corpus.index.enabled) logger.info('astro-aeo: emitted /llms.txt');
    if (config.corpus.full.enabled) logger.info('astro-aeo: emitted /llms-full.txt');
  } else if (config.corpus.index.enabled || config.corpus.full.enabled) {
    logger.info('astro-aeo: request-time middleware owns the corpus paths for on-demand routes');
  }

  emitDomainProfile(dir, config, env.siteUrl, writer);
  if (config.site.profile.enabled) logger.info('astro-aeo: emitted /.well-known/domain-profile.json');

  // Unconditional, and last, so it also covers pages every generator skipped.
  const stripped = stripSourceMarkers(
    pageDescriptors,
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

  // Persist the collection attempt even if a later integration prevents the
  // finalizer from running. Ownership resolution refreshes this same sanitized
  // manifest with its complete findings before applying the threshold.
  writeDiagnosticsManifest(env.projectRoot, pages, env.diagnostics ?? []);

  if (env.pluginDispatcher) {
    await runBuildComplete(env.pluginDispatcher, pages, env.diagnostics ?? []);
  }

  return writer;
}

/** @param {unknown} value @returns {value is import('../page.js').PageDescriptor} */
function isPageDescriptor(value) {
  const descriptor = /** @type {any} */ (value);
  return Boolean(
    descriptor &&
    typeof descriptor === 'object' &&
    typeof descriptor.pathname === 'string' &&
    (descriptor.routePattern === undefined || typeof descriptor.routePattern === 'string') &&
    (descriptor.rendering === undefined || descriptor.rendering === 'prerendered' || descriptor.rendering === 'on-demand') &&
    (descriptor.title === undefined || typeof descriptor.title === 'string') &&
    (descriptor.description === undefined || typeof descriptor.description === 'string') &&
    (descriptor.image === undefined || typeof descriptor.image === 'string') &&
    (descriptor.language === undefined || typeof descriptor.language === 'string') &&
    (descriptor.markdown === undefined || typeof descriptor.markdown === 'string')
  );
}

/** @param {unknown} value @returns {value is import('../index.js').AeoPageRecord} */
function isPageRecord(value) {
  const page = /** @type {any} */ (value);
  return Boolean(page && typeof page === 'object' && typeof page.id === 'string' &&
    typeof page.pathname === 'string' && page.metadata && page.representations &&
    Array.isArray(page.authors) && Array.isArray(page.entities) && page.directives);
}

/** @param {unknown} value @returns {value is import('../index.js').AeoPageRecord['metadata']} */
function isPageMetadata(value) {
  return Boolean(value && typeof value === 'object' && typeof /** @type {any} */ (value).title === 'string');
}

/** @param {unknown} value */
function isExtractionEnvelope(value) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    candidate.representations &&
    typeof candidate.representations === 'object' &&
    (candidate.representations.html === undefined || typeof candidate.representations.html === 'string') &&
    (candidate.representations.markdown === undefined || typeof candidate.representations.markdown === 'string') &&
    (candidate.representations.plainText === undefined || typeof candidate.representations.plainText === 'string') &&
    (candidate.extraction === null || candidate.extraction === undefined || typeof candidate.extraction === 'object') &&
    (candidate.source === undefined || (candidate.source && typeof candidate.source === 'object'))
  );
}

/** @param {unknown} value */
function isGraphEnvelope(value) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.html === 'string' &&
    isPageRecord(candidate.page) &&
    candidate.site &&
    typeof candidate.site === 'object' &&
    (candidate.graph === null || (candidate.graph && Array.isArray(candidate.graph.entries))) &&
    (candidate.normalizedGraph === undefined || candidate.normalizedGraph === null ||
      (candidate.normalizedGraph && Array.isArray(candidate.normalizedGraph.entries)))
  );
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
    const at = right ? current.indexOf(right) : current.length;
    return at === -1 ? after : `${current.slice(0, at)}${inserted}${current.slice(at)}`;
  }
  const first = current.indexOf(removed);
  if (first === -1 || current.indexOf(removed, first + removed.length) !== -1) return after;
  return `${current.slice(0, first)}${inserted}${current.slice(first + removed.length)}`;
}

/** @param {unknown} value @param {{ id: string; pathname: string }} expected */
function isArtifactEnvelope(value, expected) {
  const candidate = /** @type {any} */ (value);
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    candidate.claim?.id === expected.id &&
    candidate.claim?.pathname === expected.pathname &&
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
 */
async function emitPluginArtifacts(dispatcher, pages, writer, diagnostics) {
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
      claim: { id: claim.id, pathname: claim.pathname }, representation,
    }, {
      mode: 'build',
      pathname: claim.pathname,
      validate: (value) => isArtifactEnvelope(value, claim),
    });
    diagnostics.push(...validated.diagnostics);
    if (validated.isolated) continue;
    const validatedRepresentation = /** @type {any} */ (validated.value).representation;
    writer.write({
      route: claim.pathname,
      owner: { kind: 'plugin', name: claim.plugin, claimId: claim.id },
      replace: claim.replace,
      representation: validatedRepresentation,
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
