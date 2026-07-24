// @ts-check
import { emitRobotsTxt } from './robots-txt.js';
import { emitSitemapAlias } from './sitemap-alias.js';
import { sitemapPathExists } from '../lib/sitemap.js';

/**
 * Finalize sitemap-dependent outputs after every configured sitemap integration
 * has had a chance to write its files.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {object} options
 * @param {string} options.siteUrl
 * @param {string} options.base
 * @param {'auto'|'always'|'never'} options.sitemapPolicy
 * @param {boolean} options.sitemapExpected
 * @param {{ info: (m: string) => void; warn: (m: string) => void }} options.logger
 * @returns {{ aliasEmitted: boolean; sitemapAdvertised: boolean }}
 */
export function finalizeSitemapOutputs(
  distDir,
  config,
  { siteUrl, base, sitemapPolicy, sitemapExpected, logger },
) {
  const sourcePath = `/${config.sitemapAlias.sourceFilename}`;
  const sourceExists = sitemapPathExists(distDir, sourcePath);
  let aliasEmitted = false;

  if (sitemapExpected && !sourceExists) {
    logger.warn(
      `astro-aeo: expected sitemap source "${config.sitemapAlias.sourceFilename}" was not generated. Ensure the sitemap has at least one indexable page. If a user-registered @astrojs/sitemap uses a custom filenameBase, repeat it as \`sitemap.options.filenameBase\` so Astro-AEO can track the output.`,
    );
  }

  // A matching source is sufficient to support a manual or third-party sitemap,
  // even when astro-aeo did not register or recognize its generator.
  if (config.sitemapAlias.enabled && sourceExists) {
    aliasEmitted = emitSitemapAlias(distDir, config, logger);
    if (aliasEmitted) {
      logger.info(`astro-aeo: emitted /${config.sitemapAlias.outputFilename}`);
    }
  }

  const advertisedPathExists = sitemapPathExists(distDir, config.robotsTxt.sitemapPath);
  const sitemapAvailable =
    sitemapPolicy === 'always' ||
    (sitemapPolicy === 'auto' && advertisedPathExists);

  emitRobotsTxt(distDir, config, siteUrl, logger, base, sitemapAvailable);
  if (config.robotsTxt.enabled) logger.info('astro-aeo: emitted /robots.txt');

  const sitemapAdvertised =
    config.robotsTxt.enabled &&
    config.robotsTxt.includeSitemap &&
    Boolean(siteUrl) &&
    sitemapAvailable;
  return { aliasEmitted, sitemapAdvertised };
}
