// @ts-check
import { emitRobotsTxt } from './robots-txt.js';
import { emitSitemapAlias } from './sitemap-alias.js';
import { sitemapPathExists } from '../lib/sitemap.js';
import { createArtifactWriter } from '../build/artifacts.js';

/**
 * Finalize sitemap-dependent outputs after every configured sitemap integration
 * has had a chance to write its files.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {object} options
 * @param {string} options.siteUrl
 * @param {string} options.base
 * @param {boolean} options.sitemapExpected
 * @param {Set<string>} [options.routePaths]  Concrete route pathnames, for collision checks.
 * @param {URL} [options.publicDir]           Astro's publicDir, for collision checks.
 * @param {ReturnType<typeof createArtifactWriter>} [options.writer]
 *   The writer retained from the main build phase.
 * @param {{ info: (m: string) => void; warn: (m: string) => void }} options.logger
 * @returns {{ aliasEmitted: boolean; sitemapAdvertised: boolean }}
 */
export function finalizeSitemapOutputs(
  distDir,
  config,
  { siteUrl, base, sitemapExpected, logger, routePaths, publicDir, writer },
) {
  // Direct generator tests and third-party callers may not have a main build
  // phase, but the integration retains and supplies its writer so claims made
  // before @astrojs/sitemap remain visible here.
  const activeWriter =
    writer ?? createArtifactWriter({ distDir, logger, routePaths, publicDir });
  // Resolved from the optional `includeSitemap` tri-state in resolveConfig, so the
  // omitted-versus-false distinction never has to be recovered from raw user input.
  const sitemapPolicy = config.discovery.robots.sitemapPolicy;
  const sourcePath = `/${config.discovery.sitemap.alias.sourceFilename}`;
  const sourceExists = sitemapPathExists(distDir, sourcePath);
  let aliasEmitted = false;

  if (sitemapExpected && !sourceExists) {
    logger.warn(
      `astro-aeo: expected sitemap source "${config.discovery.sitemap.alias.sourceFilename}" was not generated. Ensure the sitemap has at least one indexable page. If a user-registered @astrojs/sitemap uses a custom filenameBase, repeat it as \`sitemap.options.filenameBase\` so Astro-AEO can track the output.`,
    );
  }

  // A matching source is sufficient to support a manual or third-party sitemap,
  // even when astro-aeo did not register or recognize its generator.
  if (config.discovery.sitemap.alias.enabled && sourceExists) {
    aliasEmitted = emitSitemapAlias(distDir, config, logger, activeWriter);
    if (aliasEmitted) {
      logger.info(`astro-aeo: emitted /${config.discovery.sitemap.alias.outputFilename}`);
    }
  }

  const advertisedPathExists = sitemapPathExists(distDir, config.discovery.robots.sitemapPath);
  const sitemapAvailable =
    sitemapPolicy === 'always' ||
    (sitemapPolicy === 'auto' && advertisedPathExists);

  emitRobotsTxt(distDir, config, siteUrl, logger, base, sitemapAvailable, activeWriter);
  if (config.discovery.robots.enabled) logger.info('astro-aeo: emitted /robots.txt');

  const sitemapAdvertised =
    config.discovery.robots.enabled &&
    config.discovery.robots.includeSitemap &&
    Boolean(siteUrl) &&
    sitemapAvailable;
  return { aliasEmitted, sitemapAdvertised };
}
