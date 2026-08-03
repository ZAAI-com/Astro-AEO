// @ts-check
import { collectPages } from '../lib/collect.js';
import { createArtifactWriter } from '../build/artifacts.js';
import { resolveSiteMeta } from '../config.js';
import { emitDotMd } from '../generators/dotmd.js';
import { emitLlmsTxt, emitLlmsFullTxt } from '../generators/llms-txt.js';
import { emitDomainProfile } from '../generators/domain-profile.js';
import { emitUrlMap } from '../generators/url-map.js';

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

  const pages = collectPages(rawPages, config, {
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

  // The URL map is the one output written to the project root rather than the
  // build output, so it is not the writer's business.
  if (config.corpus.urlMap.enabled) {
    emitUrlMap(pages, config, env.projectRoot, new Date());
    logger.info(`astro-aeo: emitted ${config.corpus.urlMap.outputFilepath}`);
  }

  return writer;
}
