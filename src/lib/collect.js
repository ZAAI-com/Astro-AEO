// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTurndown, htmlToMarkdown } from './html-to-md.js';
import { extractPageMeta, makeTitleStripper } from './page-meta.js';
import { getGitLastModified } from './git-mtime.js';
import { isIncluded, normalizePath } from './match.js';

/**
 * @typedef {object} PageInfo
 * @property {string} pathname       Normalized: leading slash, no trailing slash except root.
 * @property {string} url            Absolute URL (with trailing slash per config).
 * @property {string} htmlPath       Absolute path to the built HTML file.
 * @property {string} mdHref         Site-root-relative href to the .md companion (base-prefixed).
 * @property {string} mdPath         Absolute path where the .md companion is written.
 * @property {string} title
 * @property {string} description
 * @property {string} markdown       Converted body markdown.
 * @property {Date | undefined} lastModified
 * @property {Set<string>} aeoTokens
 */

/**
 * @typedef {object} CollectContext
 * @property {URL} distDir
 * @property {string} siteUrl              Site origin without trailing slash.
 * @property {string} base                 Astro base path (e.g. "" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 * @property {'directory'|'file'} buildFormat
 * @property {string} projectRoot          Absolute project root (for git mtime).
 * @property {Map<string, string>} routeEntrypoints  Normalized pathname -> source entrypoint (relative).
 * @property {{ warn: (m: string) => void }} logger
 */

/**
 * Read every built page once and produce the shared page model consumed by all
 * generators. Pages are skipped when: the HTML is missing, the page is a
 * redirect stub, it fails the include/exclude filter, it carries a noindex
 * directive (when respectNoindex), or it opts out via <meta name="aeo" content="skip">.
 *
 * @param {{ pathname: string }[]} rawPages
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {CollectContext} ctx
 * @returns {PageInfo[]}
 */
export function collectPages(rawPages, config, ctx) {
  const distRoot = fileURLToPath(ctx.distDir);
  const strip = makeTitleStripper(config.stripTitleSuffix);
  const td = createTurndown();
  /** @type {PageInfo[]} */
  const pages = [];

  for (const raw of rawPages) {
    const pathname = normalizePath(raw.pathname || '/');

    if (!isIncluded(pathname, { include: config.include, exclude: config.exclude })) continue;

    const htmlPath = resolveHtmlPath(distRoot, pathname, ctx.buildFormat);
    let html;
    try {
      html = readFileSync(htmlPath, 'utf8');
    } catch {
      ctx.logger.warn(`astro-aeo: could not read built HTML for ${pathname}, skipping`);
      continue;
    }

    const meta = extractPageMeta(html, strip);
    if (meta.isRedirect) continue;
    if (config.respectNoindex && meta.noindex) continue;
    if (meta.aeoTokens.has('skip')) continue;

    const markdown = htmlToMarkdown(html, td);
    const url = absoluteUrl(ctx.siteUrl, ctx.base, pathname, ctx.trailingSlash);
    const mdHref = mdHrefFor(pathname, ctx.base);
    const mdPath = pathname === '/' ? join(distRoot, 'index.md') : join(distRoot, `${pathname}.md`);

    let lastModified = meta.modifiedTime;
    if (!lastModified && config.dotmd.includeLastModified) {
      const entry = ctx.routeEntrypoints.get(pathname);
      if (entry) lastModified = getGitLastModified(join(ctx.projectRoot, entry), { cwd: ctx.projectRoot });
    }

    pages.push({
      pathname,
      url,
      htmlPath,
      mdHref,
      mdPath,
      title: meta.title,
      description: meta.description,
      markdown,
      lastModified,
      aeoTokens: meta.aeoTokens,
    });
  }

  return pages;
}

/**
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
 * Display path portion of the URL, honoring trailingSlash.
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
function urlPath(pathname, trailingSlash) {
  if (pathname === '/') return '/';
  return trailingSlash === 'never' ? pathname : `${pathname}/`;
}

/**
 * Absolute URL for a page: origin + base + trailing-slash-normalized path. Used
 * by both the build collector and the dev middleware so their `url` fields match.
 * @param {string} origin         Site origin (or dev origin) without trailing slash.
 * @param {string} base           Astro base path (e.g. "" or "/docs").
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function absoluteUrl(origin, base, pathname, trailingSlash) {
  const b = base && base !== '/' ? base.replace(/\/$/, '') : '';
  return `${origin}${b}${urlPath(pathname, trailingSlash)}`;
}

/**
 * Root-relative href to a page's .md companion, base-prefixed.
 * @param {string} pathname
 * @param {string} base
 * @returns {string}
 */
export function mdHrefFor(pathname, base = '') {
  const b = base && base !== '/' ? base.replace(/\/$/, '') : '';
  const rel = pathname === '/' ? '/index.md' : `${pathname}.md`;
  return `${b}${rel}`;
}
