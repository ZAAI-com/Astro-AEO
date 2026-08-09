// @ts-check
import { existsSync } from 'node:fs';
import { createArtifactWriter } from '../build/artifacts.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mirror (byte-copy) the sitemap index @astrojs/sitemap wrote into the build
 * output to a conventional filename at the output root, so /sitemap.xml resolves
 * alongside /sitemap-index.xml. base/trailingSlash are irrelevant: the source
 * already contains absolute <loc> URLs, so this is a pure byte copy, not a
 * regeneration. Never overwrites an existing target: it may belong to a page
 * endpoint, public file, or another integration. Never throws: a missing or
 * unwritable sitemap must not fail the build, so every failure mode is a warning
 * plus skip. Returns true only when a file was actually copied, so the caller
 * can log an honest "emitted" line.
 *
 * Must run after @astrojs/sitemap has written its file; see the appended
 * integration in src/index.js for the ordering.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {{ warn: (m: string) => void }} [logger]
 * @param {ReturnType<typeof createArtifactWriter>} [writer]  Shared writer, when one exists.
 * @returns {boolean}
 */
export function emitSitemapAlias(distDir, config, logger, writer = undefined) {
  if (!config.discovery.sitemap.alias.enabled) return false;
  const { sourceFilename, outputFilename } = config.discovery.sitemap.alias;

  // These are filenames at the output root, not paths: a separator or ".." could
  // copy a file from outside dist into the published site, or clobber a file
  // outside dist. Reject them (without throwing, unlike url-map's resolveWithinRoot).
  if (!isPlainFilename(sourceFilename) || !isPlainFilename(outputFilename)) {
    logger?.warn('astro-aeo: sitemapAlias.sourceFilename/outputFilename must be bare filenames at the build output root');
    return false;
  }

  const root = fileURLToPath(distDir);
  const srcPath = join(root, sourceFilename);
  const outPath = join(root, outputFilename);

  if (srcPath === outPath) {
    logger?.warn('astro-aeo: sitemapAlias source and output resolve to the same file; skipping');
    return false;
  }
  if (!existsSync(srcPath)) {
    logger?.warn(`astro-aeo: sitemapAlias could not find "${sourceFilename}" in the build output, so /${outputFilename} was not written. Ensure a sitemap is generated (needs Astro \`site\` and at least one indexable page); with a custom @astrojs/sitemap \`filenameBase\`, repeat it as \`sitemap.options.filenameBase\` or set \`sitemapAlias.sourceFilename\` explicitly.`);
    return false;
  }

  const write =
    writer ??
    createArtifactWriter({
      distDir,
      logger: { info: () => {}, warn: (/** @type {string} */ m) => logger?.warn(m) },
    });
  try {
    return write.write({
      path: outPath,
      owner: 'sitemapAlias',
      route: `/${outputFilename}`,
      // A byte copy, not a read-then-write, so the alias stays exact.
      copyFrom: srcPath,
      onConflict: 'skip',
      conflictMessage: `astro-aeo: ${outputFilename} already exists in the build output, leaving it in place; remove the existing output to serve the generated sitemap index at /${outputFilename}`,
    });
  } catch (err) {
    // Documented never to throw: a sitemap problem must not fail the whole build.
    logger?.warn(`astro-aeo: sitemapAlias copy failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * A bare filename at the output root: non-empty, not "."/"..", no path separator.
 * @param {string} name
 * @returns {boolean}
 */
function isPlainFilename(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}
