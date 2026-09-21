// @ts-check
import { isPageVersion } from './core/page-version.js';
import { isSourceKind, sourceKindFor } from './core/source-kind.js';

/**
 * @typedef {object} AeoPageInput
 * @property {string} [markdown]      Authored Markdown, used instead of extracting from the HTML.
 * @property {unknown} [source]       A content-collection entry; its body and data are read from it.
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [language]
 * @property {string} [version]       Documentation version label, such as `v2`.
 * @property {Date | string} [published]
 * @property {Date | string} [lastModified]
 * @property {unknown[]} [authors]
 * @property {unknown[]} [entities]
 * @property {{ index?: boolean; includeInLlms?: boolean; includeInLlmsFull?: boolean; generateMarkdown?: boolean }} [directives]
 * @property {string} [sourcePath]    Where the content came from, for diagnostics.
 * @property {'markdown'|'mdx'|'astro'|'cms'|'rendered'|'custom'} [sourceKind]
 */

/**
 * @param {AeoPageInput} input
 * @returns {import('../components/index.js').AeoPageProps}
 */
export function defineAeoPage(input = {}) {
  const entry = /** @type {any} */ (input.source);
  /** @type {import('./core/extract/marker.js').PageMarker} */
  const marker = {};

  const markdown = input.markdown ?? (typeof entry?.body === 'string' ? entry.body : undefined);
  if (typeof markdown === 'string') marker.markdown = markdown;

  const title = input.title ?? entry?.data?.title;
  if (typeof title === 'string' && title) marker.title = title;

  const description = input.description ?? entry?.data?.description;
  if (typeof description === 'string' && description) marker.description = description;

  const image = input.image ?? entry?.data?.image;
  if (typeof image === 'string' && image) marker.image = image;

  const language = input.language ?? entry?.data?.language ?? entry?.data?.lang;
  if (typeof language === 'string' && language) marker.language = language;

  const version = input.version ?? entry?.data?.version;
  if (isPageVersion(version)) marker.version = version;

  const published = input.published ?? entry?.data?.published ?? entry?.data?.pubDate;
  const publishedIso = toIsoDate(published);
  if (publishedIso) marker.published = publishedIso;

  const lastModified = input.lastModified ?? entry?.data?.updatedDate ?? entry?.data?.pubDate;
  const iso = toIsoDate(lastModified);
  if (iso) marker.lastModified = iso;

  const sourcePath = input.sourcePath ?? entry?.filePath ?? entry?.id;
  if (typeof sourcePath === 'string' && sourcePath) {
    marker.sourcePath = sourcePath;
  }
  const sourceKind = isSourceKind(input.sourceKind)
    ? input.sourceKind
    : typeof sourcePath === 'string' && sourcePath
      ? sourceKindFor(sourcePath, typeof markdown === 'string')
      : undefined;
  if (sourceKind) marker.sourceKind = sourceKind;

  if (Array.isArray(input.authors)) marker.authors = input.authors;
  if (Array.isArray(input.entities)) marker.entities = input.entities;
  if (input.directives && typeof input.directives === 'object') {
    marker.directives = Object.fromEntries(
      Object.entries(input.directives).filter(([, value]) => typeof value === 'boolean'),
    );
  }

  // The marker is the wire shape of the component props; authors and entities were typed on the way in.
  return /** @type {import('../components/index.js').AeoPageProps} */ (marker);
}

/** @param {unknown} value @returns {string | undefined} */
function toIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
