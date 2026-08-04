// @ts-check
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectPages } from '../build/collect.js';
import { createArtifactWriter } from '../build/artifacts.js';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { stripSourceMarkers } from '../build/strip-markers.js';
import { loadCatalogPages } from '../build/catalogs.js';
import { resolveSiteMeta } from '../config.js';
import { emitDotMd } from '../generators/dotmd.js';
import { emitLlmsTxt, emitLlmsFullTxt } from '../generators/llms-txt.js';
import { emitDomainProfile } from '../generators/domain-profile.js';
import { emitUrlMap } from '../generators/url-map.js';

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
  const catalogPages = config.pages.catalogs.length
    ? await loadCatalogPages(config.pages.catalogs, (/** @type {string} */ m) => import(resolveCatalog(m, env.projectRoot)), logger)
    : [];
  if (catalogPages.length) {
    logger.info(`astro-aeo: ${catalogPages.length} page(s) contributed by catalogs`);
  }

  const pages = collectPages([...rawPages, ...catalogPages], config, {
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

  emitLlmsTxt(pages, dir, config, siteName, siteDescription, writer);
  emitLlmsFullTxt(pages, dir, config, siteName, siteDescription, writer);
  if (config.corpus.index.enabled) logger.info('astro-aeo: emitted /llms.txt');
  if (config.corpus.full.enabled) logger.info('astro-aeo: emitted /llms-full.txt');

  emitDomainProfile(dir, config, env.siteUrl, writer);
  if (config.site.profile.enabled) logger.info('astro-aeo: emitted /.well-known/domain-profile.json');

  // Unconditional, and last, so it also covers pages every generator skipped.
  const stripped = stripSourceMarkers(
    rawPages,
    createDistHtmlSource({ distDir: dir, buildFormat: env.buildFormat }),
  );
  if (stripped) logger.info(`astro-aeo: removed the source marker from ${stripped} page(s)`);

  // The URL map is the one output written to the project root rather than the
  // build output, so it is not the writer's business.
  if (config.corpus.urlMap.enabled) {
    emitUrlMap(pages, config, env.projectRoot, new Date());
    logger.info(`astro-aeo: emitted ${config.corpus.urlMap.outputFilepath}`);
  }

  return writer;
}
