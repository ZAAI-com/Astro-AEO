// @ts-check
import { emitRobotsTxt } from './robots-txt.js';
import { emitSitemapAlias } from './sitemap-alias.js';
import { sitemapPathExists } from '../lib/sitemap.js';
import { createArtifactWriter } from '../build/artifacts.js';
import { validateLocalSitemap } from '../build/sitemap-validate.js';

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
 * @param {{ pattern: RegExp; prerendered: boolean }[]} [options.routeMatchers]
 *   Dynamic project routes, for collision checks.
 * @param {URL} [options.publicDir]           Astro's publicDir, for collision checks.
 * @param {Iterable<string>} [options.runtimeUrls] Canonical runtime URLs accepted by the sitemap.
 * @param {(diagnostic: import('../index.js').Diagnostic) => void} [options.onDiagnostic]
 * @param {ReturnType<typeof createArtifactWriter>} [options.writer]
 *   The writer retained from the main build phase.
 * @param {{ info: (m: string) => void; warn: (m: string) => void }} options.logger
 * @returns {{ aliasEmitted: boolean; sitemapAdvertised: boolean }}
 */
export function finalizeSitemapOutputs(
  distDir,
  config,
  { siteUrl, base, sitemapExpected, logger, routePaths, routeMatchers, publicDir, runtimeUrls, onDiagnostic, writer },
) {
  // Direct generator tests and third-party callers may not have a main build
  // phase, but the integration retains and supplies its writer so claims made
  // before @astrojs/sitemap remain visible here.
  const activeWriter =
    writer ?? createArtifactWriter({ distDir, logger, routePaths, routeMatchers, publicDir });
  // Resolved from the optional `includeSitemap` tri-state in resolveConfig, so the
  // omitted-versus-false distinction never has to be recovered from raw user input.
  const sitemapPolicy = config.discovery.robots.sitemapPolicy;
  const sourcePath = `/${config.discovery.sitemap.alias.sourceFilename}`;
  const sourceExists = sitemapPathExists(distDir, sourcePath);
  const validationCache = new Map();
  let aliasEmitted = false;

  if (sitemapExpected && !sourceExists) {
    logger.warn(
      `astro-aeo: expected sitemap source "${config.discovery.sitemap.alias.sourceFilename}" was not generated. Ensure the sitemap has at least one indexable page. If a user-registered @astrojs/sitemap uses a custom filenameBase, repeat it as \`sitemap.options.filenameBase\` so Astro-AEO can track the output.`,
    );
  }

  // A matching source is sufficient to support a manual or third-party sitemap,
  // even when astro-aeo did not register or recognize its generator.
  const sourceValid = sourceExists && validate(sourcePath);
  if (
    config.discovery.sitemap.mode !== 'disabled' &&
    config.discovery.sitemap.alias.enabled &&
    sourceValid
  ) {
    aliasEmitted = emitSitemapAlias(distDir, config, logger, activeWriter);
    if (aliasEmitted) {
      logger.info(`astro-aeo: emitted /${config.discovery.sitemap.alias.outputFilename}`);
    }
  }

  const advertisedPathExists =
    sitemapPathExists(distDir, config.discovery.robots.sitemapPath) &&
    !activeWriter.isPlannedStaleDeletion?.(config.discovery.robots.sitemapPath);
  const advertisedAliasClaimed =
    aliasEmitted &&
    config.discovery.robots.sitemapPath ===
      `/${config.discovery.sitemap.alias.outputFilename}`;
  const advertisedPathValid = advertisedPathExists
    ? validate(config.discovery.robots.sitemapPath)
    : false;
  // `always` can advertise a runtime sitemap for which no static file exists.
  // A local file is stronger evidence, however, and malformed local XML must
  // never be hidden behind the runtime override.
  const sitemapAvailable = sitemapPolicy === 'always'
    ? advertisedPathExists ? advertisedPathValid : true
    : sitemapPolicy === 'auto' && (advertisedPathValid || advertisedAliasClaimed);

  const llmsAvailable = acceptedRootLlms(activeWriter, base, config.corpus.index.enabled);
  emitRobotsTxt(
    distDir,
    config,
    siteUrl,
    logger,
    base,
    sitemapAvailable,
    activeWriter,
    llmsAvailable,
  );
  if (config.discovery.robots.enabled) logger.info('astro-aeo: emitted /robots.txt');

  const sitemapAdvertised =
    config.discovery.robots.enabled &&
    config.discovery.robots.includeSitemap &&
    Boolean(siteUrl) &&
    sitemapAvailable;
  return { aliasEmitted, sitemapAdvertised };

  /** @param {string} pathname */
  function validate(pathname) {
    if (config.discovery.sitemap.mode === 'disabled') return false;
    const cached = validationCache.get(pathname);
    if (cached !== undefined) return cached;
    const result = validateLocalSitemap({
      distDir,
      entryPath: pathname,
      siteUrl,
      base,
      routePaths,
      runtimeUrls,
    });
    validationCache.set(pathname, result.valid);
    for (const finding of result.findings) {
      const message = `astro-aeo: ${finding.message}`;
      logger.warn(message);
      onDiagnostic?.({
        version: 1,
        code: finding.code,
        severity: finding.severity,
        message,
        ...(finding.pathname ? { pathname: finding.pathname } : {}),
        ...(finding.sourcePath ? { sourcePath: finding.sourcePath } : {}),
      });
    }
    return result.valid;
  }
}

/**
 * Deferred builds advertise only a root corpus claim the ownership preview
 * accepted. Immediate generator callers retain the legacy config-derived path.
 * @param {ReturnType<typeof createArtifactWriter>} writer
 * @param {string} base
 * @param {boolean} fallback
 */
function acceptedRootLlms(writer, base, fallback) {
  if (!writer.isDeferred || typeof /** @type {any} */ (writer).preview !== 'function') return fallback;
  const b = base && base !== '/' ? `/${base.replace(/^\/+|\/+$/g, '')}` : '';
  const pathname = `${b}/llms.txt`;
  const preview = /** @type {any} */ (writer).preview();
  return Boolean(preview.manifestEntries?.some((/** @type {any} */ entry) =>
    entry.pathname === pathname && (entry.status === 'emitted' || entry.status === 'runtime')
  ));
}
