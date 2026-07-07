// @ts-check
import { collectPages } from '../lib/collect.js';
import { resolveSiteMeta } from '../config.js';
import { emitDotMd } from '../generators/dotmd.js';
import { emitLlmsTxt, emitLlmsFullTxt } from '../generators/llms-txt.js';
import { emitRobotsTxt } from '../generators/robots-txt.js';
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
 */

/**
 * Orchestrate all build-time outputs.
 *
 * @param {import('../index.js').ResolvedAeoConfig} config
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

  const written = emitDotMd(pages, config);
  if (config.dotmd.enabled) logger.info(`astro-aeo: emitted ${written} .md companion files`);

  emitLlmsTxt(pages, dir, config, siteName, siteDescription);
  emitLlmsFullTxt(pages, dir, config, siteName, siteDescription);
  if (config.llmsTxt.enabled) logger.info('astro-aeo: emitted /llms.txt');
  if (config.llmsFullTxt.enabled) logger.info('astro-aeo: emitted /llms-full.txt');

  emitRobotsTxt(dir, config, env.siteUrl, logger, env.base);
  if (config.robotsTxt.enabled) logger.info('astro-aeo: emitted /robots.txt');

  emitDomainProfile(dir, config, env.siteUrl);
  if (config.domainProfile.enabled) logger.info('astro-aeo: emitted /.well-known/domain-profile.json');

  if (config.urlMap.enabled) {
    emitUrlMap(pages, config, env.projectRoot, new Date());
    logger.info(`astro-aeo: emitted ${config.urlMap.outputFilepath}`);
  }
}
