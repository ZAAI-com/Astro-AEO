// @ts-check

/**
 * `defineAeoPage` and the catalog contract: the two ways a project tells
 * astro-aeo something its rendered HTML cannot.
 */

/**
 * @typedef {object} AeoPageInput
 * @property {string} [markdown]      Authored Markdown, used instead of extracting from the HTML.
 * @property {unknown} [source]       A content-collection entry; its body and data are read from it.
 * @property {string} [title]
 * @property {string} [description]
 * @property {Date | string} [lastModified]
 * @property {string} [sourcePath]    Where the content came from, for diagnostics.
 */

/**
 * Normalize what a page knows about itself into the marker payload.
 *
 * Extraction can only ever approximate a page from its rendered HTML: a heading
 * that was `##` in the source is an `<h2>` by the time it is served, and the
 * original wording of a code fence or a table is gone. Where a page was built
 * from Markdown, the page itself is the only thing that still has the original.
 *
 * Everything is optional. Supplying nothing is the same as not calling this at
 * all, and extraction runs as usual.
 *
 * @param {AeoPageInput} input
 * @returns {import('./core/extract/marker.js').PageMarker}
 */
export function defineAeoPage(input = {}) {
  const entry = /** @type {any} */ (input.source);
  /** @type {import('./core/extract/marker.js').PageMarker} */
  const marker = {};

  const markdown = input.markdown ?? (typeof entry?.body === 'string' ? entry.body : undefined);
  if (markdown) marker.markdown = markdown;

  const title = input.title ?? entry?.data?.title;
  if (typeof title === 'string' && title) marker.title = title;

  const description = input.description ?? entry?.data?.description;
  if (typeof description === 'string' && description) marker.description = description;

  const lastModified = input.lastModified ?? entry?.data?.updatedDate ?? entry?.data?.pubDate;
  const iso = toIsoDate(lastModified);
  if (iso) marker.lastModified = iso;

  const sourcePath = input.sourcePath ?? entry?.filePath ?? entry?.id;
  if (typeof sourcePath === 'string' && sourcePath) marker.sourcePath = sourcePath;

  return marker;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function toIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
