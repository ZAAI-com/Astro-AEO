// @ts-check
import { join } from 'node:path';
import { createTurndown } from '../core/html-to-md.js';
import { makeTitleStripper } from '../core/page-meta.js';
import { buildPage, mdPathnameFor } from '../core/page-model.js';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { getGitLastModified } from '../lib/git-mtime.js';
import { normalizePath } from '../core/match.js';

/**
 * @typedef {import('../core/page-model.js').BuildPage} BuildPage
 * @typedef {import('../core/page-model.js').AeoPage} AeoPage
 */

/**
 * Kept as an alias because the generators and their tests refer to this name.
 * @typedef {BuildPage} PageInfo
 */

/**
 * @typedef {object} CollectContext
 * @property {URL} distDir
 * @property {string} siteUrl              Site origin without trailing slash.
 * @property {string} base                 Astro base path (e.g. "" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 * @property {'directory'|'file'} buildFormat
 * @property {string} projectRoot          Absolute project root (for git mtime).
 * @property {Map<string, string>} routeEntrypoints  Normalized pathname -> source entrypoint.
 * @property {{ warn: (m: string) => void }} logger
 */

/**
 * Read every built page once and produce the shared page model consumed by all
 * generators.
 *
 * The normalization itself lives in `core/page-model.js` and is shared with the
 * server. What is added here is what only a build knows: where the HTML came
 * from, where the `.md` goes, and the git history fallback for a page that does
 * not state its own modified time.
 *
 * @param {{ pathname: string }[]} rawPages
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {CollectContext} ctx
 * @returns {BuildPage[]}
 */
export function collectPages(rawPages, config, ctx) {
  const source = createDistHtmlSource({ distDir: ctx.distDir, buildFormat: ctx.buildFormat });
  const strip = makeTitleStripper(config.pages.stripTitleSuffix);
  const td = createTurndown();
  const site = { siteUrl: ctx.siteUrl, base: ctx.base, trailingSlash: ctx.trailingSlash };
  /** @type {BuildPage[]} */
  const pages = [];

  for (const raw of rawPages) {
    const pathname = normalizePath(raw.pathname || '/');

    const read = source.read(pathname);
    if (!read) {
      ctx.logger.warn(`astro-aeo: could not read built HTML for ${pathname}, skipping`);
      continue;
    }

    const result = buildPage({ pathname, html: read.html, config, site, td, strip });
    if ('skip' in result) continue;

    pages.push({
      ...result.page,
      htmlPath: read.htmlPath,
      mdPath: join(source.root, mdPathnameFor(pathname)),
      lastModified: result.page.lastModified ?? gitLastModified(pathname, config, ctx),
    });
  }

  return pages;
}

/**
 * Fall back to git history for a page that does not declare a modified time.
 * Build-only: it needs the route-to-source map and the project root, neither of
 * which exists at request time.
 *
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {CollectContext} ctx
 * @returns {Date | undefined}
 */
function gitLastModified(pathname, config, ctx) {
  if (!config.markdown.includeLastModified) return undefined;
  const entry = ctx.routeEntrypoints.get(pathname);
  if (!entry) return undefined;
  return getGitLastModified(join(ctx.projectRoot, entry), { cwd: ctx.projectRoot });
}

// The URL helpers moved to core/page-model.js so the server can use them without
// importing a module that reads the filesystem. Re-exported for existing callers.
export { absoluteUrl, mdHrefFor, urlPath } from '../core/page-model.js';
export { resolveHtmlPath } from '../sources/dist-html.js';
