// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The build's HTML source: rendered pages read back out of the build output.
 *
 * This is the filesystem half of the pipeline, deliberately separated from
 * `src/core/` so the normalization that follows it stays runnable where there is
 * no filesystem at all.
 */

/**
 * Where a page's rendered HTML lands in the build output.
 * @param {string} distRoot
 * @param {string} pathname
 * @param {'directory'|'file'} buildFormat
 * @returns {string}
 */
export function resolveHtmlPath(distRoot, pathname, buildFormat) {
  if (pathname === '/') return join(distRoot, 'index.html');
  if (buildFormat === 'file') return join(distRoot, `${pathname}.html`);
  return join(distRoot, pathname, 'index.html');
}

/**
 * @param {object} deps
 * @param {URL} deps.distDir
 * @param {'directory'|'file'} deps.buildFormat
 */
export function createDistHtmlSource({ distDir, buildFormat }) {
  const root = fileURLToPath(distDir);
  return {
    root,
    /**
     * @param {string} pathname
     * @returns {string}
     */
    htmlPathFor(pathname) {
      return resolveHtmlPath(root, pathname, buildFormat);
    },
    /**
     * @param {string} pathname
     * @returns {{ html: string; htmlPath: string } | null} null when unreadable.
     */
    read(pathname) {
      const htmlPath = resolveHtmlPath(root, pathname, buildFormat);
      try {
        return { html: readFileSync(htmlPath, 'utf8'), htmlPath };
      } catch {
        return null;
      }
    },
  };
}
