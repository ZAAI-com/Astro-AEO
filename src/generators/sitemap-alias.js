// @ts-check
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mirror (byte-copy) the sitemap index @astrojs/sitemap wrote into the build
 * output to a conventional filename at the output root, so /sitemap.xml resolves
 * alongside /sitemap-index.xml. base/trailingSlash are irrelevant: the source
 * already contains absolute <loc> URLs, so this is a pure byte copy, not a
 * regeneration. Never throws: a missing or unwritable sitemap must not fail the
 * build, so every failure mode is a warning + skip. Returns true only when a
 * file was actually copied, so the caller can log an honest "emitted" line.
 *
 * Must run after @astrojs/sitemap has written its file; see the appended
 * integration in src/index.js for the ordering.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {{ warn: (m: string) => void }} [logger]
 * @param {URL} [publicDir]  Project public/ dir. A hand-authored static file here
 *   (Astro copies it into dist before build:done) is never overwritten.
 * @returns {boolean}
 */
export function emitSitemapAlias(distDir, config, logger, publicDir) {
  if (!config.sitemapAlias.enabled) return false;
  const { sourceFilename, outputFilename } = config.sitemapAlias;

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
    logger?.warn(`astro-aeo: sitemapAlias could not find "${sourceFilename}" in the build output, so /${outputFilename} was not written. Ensure a sitemap is generated (needs Astro \`site\` and at least one indexable page); with a custom @astrojs/sitemap \`filenameBase\`, set \`sitemapAlias.sourceFilename\` to "<base>-index.xml".`);
    return false;
  }

  // Never clobber a hand-authored public/<outputFilename> (Astro copies public/
  // into dist before build:done). Overwriting our own prior output is fine, so
  // we key on the source in public/, not on the presence of the dist file.
  if (publicDir && existsSync(join(fileURLToPath(publicDir), outputFilename))) {
    logger?.warn(`astro-aeo: a static ${outputFilename} exists in public/, leaving it in place; remove it to serve the generated sitemap index at /${outputFilename}`);
    return false;
  }
  try {
    copyFileSync(srcPath, outPath);
  } catch (err) {
    logger?.warn(`astro-aeo: sitemapAlias copy failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return true;
}

/**
 * A bare filename at the output root: non-empty, not "."/"..", no path separator.
 * @param {string} name
 * @returns {boolean}
 */
function isPlainFilename(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}
