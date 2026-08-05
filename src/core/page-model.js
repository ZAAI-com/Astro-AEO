// @ts-check
import { createTurndown } from './html-to-md.js';
import { extractMarkdown } from './extract/index.js';
import { extractPageMeta, makeTitleStripper } from './page-meta.js';
import { isIncluded, normalizePath } from './match.js';
import { parseDocument } from './html-document.js';
import { readMarker, removeMarkers } from './extract/marker.js';

/**
 * @typedef {object} SiteFacts
 * @property {string} siteUrl                          Origin without a trailing slash.
 * @property {string} base                             Astro base path ("" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 */

/**
 * @typedef {object} AeoPageRecord
 * @property {string} pathname       Normalized: leading slash, no trailing slash except root.
 * @property {string} url            Absolute URL, honouring base and trailingSlash.
 * @property {string} mdHref         Root-relative, base-prefixed href to the .md companion.
 * @property {string} title
 * @property {string} description
 * @property {string} markdown
 * @property {'prerendered'|'on-demand'} rendering
 * @property {string | undefined} lastModified  ISO timestamp when known.
 * @property {string[]} aeoTokens
 * @property {import('./extract/index.js').ExtractionDiagnostics} [extraction]
 * @property {{ strategy: 'marker'|'markdown-route'|'rendered'|'catalog'; path?: string }} source
 * @property {import('../index.js').Diagnostic[]} diagnostics
 */

/** @typedef {AeoPageRecord} AeoPage  Compatibility alias for existing internal imports. */

/**
 * A page plus the filesystem locations only a build has.
 * @typedef {AeoPageRecord & { htmlPath: string; mdPath: string }} BuildPage
 */

/** Why a page produced no record. Every branch is reported, never silently dropped. */
/** @typedef {'excluded'|'redirect'|'noindex'|'skip-token'} SkipReason */

/**
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function urlPath(pathname, trailingSlash) {
  if (pathname === '/') return '/';
  return trailingSlash === 'never' ? pathname : `${pathname}/`;
}

/**
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
 * @param {string} pathname
 * @param {string} [base]
 * @returns {string}
 */
export function mdHrefFor(pathname, base = '') {
  return `${basePrefix(base)}${mdPathnameFor(pathname)}`;
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function mdPathnameFor(pathname) {
  return pathname === '/' ? '/index.md' : `${pathname}.md`;
}

/**
 * @param {string} mdPathname
 * @returns {string | null}
 */
export function pagePathForMdPath(mdPathname) {
  if (!mdPathname.endsWith('.md')) return null;
  if (mdPathname === '/index.md') return '/';
  return normalizePath(mdPathname.slice(0, -'.md'.length));
}

/**
 * @param {string} base
 * @returns {string}
 */
export function basePrefix(base) {
  return base && base !== '/' ? base.replace(/\/$/, '') : '';
}

/**
 * @param {object} input
 * @param {string} input.pathname
 * @param {string} input.html
 * @param {import('../index.js').ResolvedAstroAeoConfig} input.config
 * @param {SiteFacts} input.site
 * @param {import('turndown')} [input.td]
 * @param {() => Promise<import('turndown')>} [input.getTurndown]
 * @param {{ markdown?: string; title?: string; description?: string; lastModified?: string; path?: string; strategy?: 'markdown-route'|'catalog'; extraction?: import('./extract/index.js').ExtractionDiagnostics }} [input.authored]
 * @param {boolean} [input.allowMarker]
 * @param {'prerendered'|'on-demand'} [input.rendering]
 * @param {(title: string) => string} [input.strip]  Reused instance; derived from config when absent.
 * @returns {Promise<{ page: AeoPage } | { skip: SkipReason }>}
 */
export async function buildPage({ pathname: rawPathname, html, config, site, td, getTurndown, authored, allowMarker = true, rendering = 'on-demand', strip }) {
  const pathname = normalizePath(rawPathname || '/');

  if (!isIncluded(pathname, { include: config.pages.include, exclude: config.pages.exclude })) {
    return { skip: 'excluded' };
  }

  const meta = extractPageMeta(html, strip ?? makeTitleStripper(config.pages.stripTitleSuffix));
  if (meta.isRedirect) return { skip: 'redirect' };
  if (config.pages.respectNoindex && meta.noindex) return { skip: 'noindex' };
  if (meta.aeoTokens.has('skip')) return { skip: 'skip-token' };

  const url = absoluteUrl(site.siteUrl, site.base, pathname, site.trailingSlash);

  const document = parseDocument(html);
  const marker = allowMarker ? readMarker(document) : null;
  removeMarkers(document);

  const authoredMarkdown = typeof authored?.markdown === 'string' ? authored.markdown : undefined;
  const markerMarkdown = typeof marker?.markdown === 'string' ? marker.markdown : undefined;
  const markerWins = markerMarkdown !== undefined;
  const authoredWins = !markerWins && authoredMarkdown !== undefined;
  const sourceMarkdown = markerMarkdown ?? authoredMarkdown;
  let markdown;
  /** @type {import('./extract/index.js').ExtractionDiagnostics | undefined} */
  let extraction = authoredWins ? authored?.extraction : undefined;
  if (sourceMarkdown !== undefined) {
    markdown = sourceMarkdown;
  } else {
    const extracted = extractMarkdown(
      document,
      config.markdown.extraction,
      td ?? (await (getTurndown ?? createTurndown)()),
      { baseUrl: url },
    );
    markdown = extracted.markdown;
    extraction = extracted.diagnostics;
  }

  return {
    page: {
      pathname,
      url,
      mdHref: mdHrefFor(pathname, site.base),
      title: marker?.title || authored?.title || meta.title,
      description: marker?.description || authored?.description || meta.description,
      markdown,
      rendering,
      lastModified:
        toIsoTimestamp(marker?.lastModified) ??
        toIsoTimestamp(authored?.lastModified) ??
        toIsoTimestamp(meta.modifiedTime),
      aeoTokens: [...meta.aeoTokens],
      extraction,
      source: {
        strategy: markerWins
          ? 'marker'
          : authoredWins
            ? authored?.strategy ?? 'markdown-route'
            : 'rendered',
        ...(markerWins
          ? typeof marker?.sourcePath === 'string' && marker.sourcePath
            ? { path: marker.sourcePath }
            : {}
          : typeof marker?.sourcePath === 'string' && marker.sourcePath
              ? { path: marker.sourcePath }
            : authored?.path
              ? { path: authored.path }
              : {}),
      },
      diagnostics: [],
    },
  };
}

/**
 * @param {Date | string | undefined} value
 * @returns {string | undefined}
 */
export function toIsoTimestamp(value) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
