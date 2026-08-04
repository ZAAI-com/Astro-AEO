// @ts-check
import { htmlToMarkdownWithDiagnostics } from './html-to-md.js';
import { extractPageMeta, makeTitleStripper } from './page-meta.js';
import { isIncluded, normalizePath } from './match.js';

/**
 * The normalized page record and the single step that produces it.
 *
 * Nothing here touches the filesystem. The HTML may have come from build output,
 * from a dev self-fetch, or from a rendered response at request time; past this
 * point those are indistinguishable, which is what stops the build and the server
 * from drifting apart as they previously did.
 */

/**
 * @typedef {object} SiteFacts
 * @property {string} siteUrl                          Origin without a trailing slash.
 * @property {string} base                             Astro base path ("" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 */

/**
 * A page as every renderer sees it.
 * @typedef {object} AeoPage
 * @property {string} pathname       Normalized: leading slash, no trailing slash except root.
 * @property {string} url            Absolute URL, honouring base and trailingSlash.
 * @property {string} mdHref         Root-relative, base-prefixed href to the .md companion.
 * @property {string} title
 * @property {string} description
 * @property {string} markdown
 * @property {Date | undefined} lastModified
 * @property {Set<string>} aeoTokens
 * @property {import('./extract/index.js').ExtractionDiagnostics} [extraction]
 */

/**
 * A page plus the filesystem locations only a build has.
 * @typedef {AeoPage & { htmlPath: string; mdPath: string }} BuildPage
 */

/** Why a page produced no record. Every branch is reported, never silently dropped. */
/** @typedef {'excluded'|'redirect'|'noindex'|'skip-token'} SkipReason */

/**
 * Display path portion of a URL, honouring trailingSlash. Exported so the build
 * collector and the server share one implementation instead of two copies.
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function urlPath(pathname, trailingSlash) {
  if (pathname === '/') return '/';
  return trailingSlash === 'never' ? pathname : `${pathname}/`;
}

/**
 * Absolute URL for a page: origin + base + trailing-slash-normalized path.
 * @param {string} origin  Site origin (or dev origin) without a trailing slash.
 * @param {string} base
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function absoluteUrl(origin, base, pathname, trailingSlash) {
  return `${origin}${basePrefix(base)}${urlPath(pathname, trailingSlash)}`;
}

/**
 * Root-relative href to a page's .md companion, base-prefixed.
 * @param {string} pathname
 * @param {string} [base]
 * @returns {string}
 */
export function mdHrefFor(pathname, base = '') {
  return `${basePrefix(base)}${mdPathnameFor(pathname)}`;
}

/**
 * The .md pathname for a page, without any base prefix.
 * @param {string} pathname
 * @returns {string}
 */
export function mdPathnameFor(pathname) {
  return pathname === '/' ? '/index.md' : `${pathname}.md`;
}

/**
 * The page a .md request refers to, or null when the path is not a companion.
 * The inverse of `mdPathnameFor`.
 * @param {string} mdPathname
 * @returns {string | null}
 */
export function pagePathForMdPath(mdPathname) {
  if (!mdPathname.endsWith('.md')) return null;
  if (mdPathname === '/index.md') return '/';
  return normalizePath(mdPathname.slice(0, -'.md'.length));
}

/**
 * Astro's `base`, trimmed to a prefix that concatenates cleanly. "" and "/" both
 * mean no prefix.
 * @param {string} base
 * @returns {string}
 */
export function basePrefix(base) {
  return base && base !== '/' ? base.replace(/\/$/, '') : '';
}

/**
 * The single normalize step: a rendered document in, a page record or a reason
 * it was skipped out.
 *
 * @param {object} input
 * @param {string} input.pathname
 * @param {string} input.html
 * @param {import('../index.js').ResolvedAstroAeoConfig} input.config
 * @param {SiteFacts} input.site
 * @param {import('turndown')} [input.td]
 * @param {(title: string) => string} [input.strip]  Reused instance; derived from config when absent.
 * @returns {{ page: AeoPage } | { skip: SkipReason }}
 */
export function buildPage({ pathname: rawPathname, html, config, site, td, strip }) {
  const pathname = normalizePath(rawPathname || '/');

  if (!isIncluded(pathname, { include: config.pages.include, exclude: config.pages.exclude })) {
    return { skip: 'excluded' };
  }

  // Deriving this from config when the caller does not supply one keeps the
  // option working everywhere. Callers in a loop pass their own so the regular
  // expression is compiled once rather than per page.
  const meta = extractPageMeta(html, strip ?? makeTitleStripper(config.pages.stripTitleSuffix));
  if (meta.isRedirect) return { skip: 'redirect' };
  if (config.pages.respectNoindex && meta.noindex) return { skip: 'noindex' };
  if (meta.aeoTokens.has('skip')) return { skip: 'skip-token' };

  // The URL is computed before conversion because it is also the base that makes
  // relative links in the extracted content absolute.
  const url = absoluteUrl(site.siteUrl, site.base, pathname, site.trailingSlash);
  const { markdown, diagnostics } = htmlToMarkdownWithDiagnostics(
    html,
    config.markdown.extraction,
    td,
    { baseUrl: url },
  );

  return {
    page: {
      pathname,
      url,
      mdHref: mdHrefFor(pathname, site.base),
      title: meta.title,
      description: meta.description,
      markdown,
      lastModified: meta.modifiedTime,
      aeoTokens: meta.aeoTokens,
      extraction: diagnostics,
    },
  };
}
