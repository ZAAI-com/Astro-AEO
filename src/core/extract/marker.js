// @ts-check

export const MARKER_SELECTOR = 'script[data-astro-aeo-marker]';
export const MARKER_MIME = 'application/vnd.astro-aeo+json';
// The component emits source only while this private collection flag is set.
export const COLLECT_FLAG = 'astroAeoCollect';

/**
 * @typedef {object} PageMarker
 * @property {string} [markdown]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [sourcePath]
 * @property {string} [lastModified]
 */

/**
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
 * @param {Document} document
 * @returns {number} markers removed
 */
export function removeMarkers(document) {
  const found = [...document.querySelectorAll(MARKER_SELECTOR)];
  for (const el of found) el.remove();
  return found.length;
}

/**
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
