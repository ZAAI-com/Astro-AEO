// @ts-check
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectPages } from '../build/collect.js';
import { createArtifactWriter } from '../build/artifacts.js';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { stripSourceMarkers } from '../build/strip-markers.js';
import { loadCatalogPages, mergeCatalogPages } from '../build/catalogs.js';
import { resolveSiteMeta } from '../config.js';
import { emitDotMd } from '../generators/dotmd.js';
import { emitLlmsTxt, emitLlmsFullTxt } from '../generators/llms-txt.js';
import { emitDomainProfile } from '../generators/domain-profile.js';
import { emitUrlMap } from '../generators/url-map.js';
import { writeDiagnosticsManifest } from '../build/diagnostics.js';
import { isOwnedArtifactPath } from '../core/owned-artifacts.js';

/**
 * Resolve a catalog specifier the way the project wrote it: a relative path is
 * relative to the project root, and a bare specifier resolves as an import.
 * @param {string} specifier
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveCatalog(specifier, projectRoot) {
  return specifier.startsWith('.') ? pathToFileURL(join(projectRoot, specifier)).href : specifier;
}

/**
 * @typedef {object} BuildEnv
 * @property {string} siteUrl
 * @property {string} base
 * @property {'always'|'never'|'ignore'} trailingSlash
 * @property {'directory'|'file'} buildFormat
 * @property {string} projectRoot
 * @property {Map<string, string>} routeEntrypoints
 * @property {Set<string>} [resolvedRoutePaths]  Concrete route pathnames, for collision checks.
 * @property {URL} [publicDir]                   Astro's publicDir, for collision checks.
 * @property {import('../index.js').Diagnostic[]} [diagnostics]
 * @property {boolean} [runtimeCorpora]            Leave corpus paths to middleware.
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
  const loadedCatalogPages = config.pages.catalogs.length
    ? await loadCatalogPages(
        config.pages.catalogs,
        (/** @type {string} */ m) => import(resolveCatalog(m, env.projectRoot)),
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

  const pageDescriptors = mergeCatalogPages(rawPages, catalogPages);
  const pages = await collectPages(pageDescriptors, config, {
    distDir: dir,
    siteUrl: env.siteUrl,
    base: env.base,
    trailingSlash: env.trailingSlash,
    buildFormat: env.buildFormat,
    projectRoot: env.projectRoot,
    routeEntrypoints: env.routeEntrypoints,
    logger,
  });

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
    publicDir: env.publicDir,
  });

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

  writeDiagnosticsManifest(env.projectRoot, pages, env.diagnostics ?? []);

  return writer;
}
