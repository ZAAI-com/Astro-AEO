// @ts-check

/**
 * The source marker: how a page tells the pipeline what it was made from.
 *
 * Extraction can only ever recover an approximation of a page from its rendered
 * HTML. When a page is built from Markdown, the original is strictly better, and
 * the page is the only place that knows it. `<AeoPage>` writes that here, and the
 * pipeline reads and removes it before anything is written or sent.
 */

/** The element the marker component emits. */
export const MARKER_SELECTOR = 'script[data-astro-aeo-marker]';

/** Its type attribute. Unknown to browsers, so the content is never executed. */
export const MARKER_MIME = 'application/vnd.astro-aeo+json';

/**
 * The `Astro.locals` flag that tells `<AeoPage>` it is being read by astro-aeo
 * rather than by a browser.
 *
 * Without this the marker is emitted on every render, so a normal page request
 * would ship the page's own source to the client: pure overhead at best, and a
 * disclosure at worst. The flag is set on the build's prerender pass (where the
 * build reads the HTML back off disk and strips the marker afterwards) and before
 * a request-time rewrite, and at no other time.
 */
export const COLLECT_FLAG = 'astroAeoCollect';

/**
 * @typedef {object} PageMarker
 * @property {string} [markdown]     Authored Markdown, preferred over extraction.
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [sourcePath]   Where the content came from, for diagnostics.
 * @property {string} [lastModified] ISO date.
 */

/**
 * Read the marker out of a parsed document, if the page emitted one.
 *
 * A malformed marker is ignored rather than thrown on: it must never be able to
 * fail a build, and extraction is always available as the fallback.
 *
 * @param {Document} document
 * @returns {PageMarker | null}
 */
export function readMarker(document) {
  const el = document.querySelector(MARKER_SELECTOR);
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent ?? '');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remove every marker from a document.
 *
 * Always called, whether or not the marker was used, because the marker is an
 * internal channel and must not reach a browser or a `.md` reader.
 *
 * @param {Document} document
 * @returns {number} markers removed
 */
export function removeMarkers(document) {
  const found = [...document.querySelectorAll(MARKER_SELECTOR)];
  for (const el of found) el.remove();
  return found.length;
}

/**
 * Remove markers from an HTML string.
 *
 * The build rewrites its HTML files as text (it already does so for the alternate
 * link), so this avoids a reparse-and-reserialize round trip that would rewrite
 * the whole document. The pattern is anchored on the data attribute the component
 * emits, and is deliberately narrow.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripMarkersFromHtml(html) {
  if (!html.includes('data-astro-aeo-marker')) return html;
  return html.replace(
    /<script\b[^>]*\bdata-astro-aeo-marker\b[^>]*>[\s\S]*?<\/script>/gi,
    '',
  );
}
