// @ts-check
import { writeFileSync } from 'node:fs';
import { stripMarkersFromHtml } from '../core/extract/marker.js';
import { stripAeoHeadMarkers } from '../core/head.js';

/**
 * Remove every source marker from the build output.
 *
 * Unconditional, and separate from any generator, because removal must not depend
 * on a feature being enabled. The alternate-link pass would have been a tempting
 * place to do this, but it skips `no-dotmd` pages, skips everything when
 * `alternateLink` is 'never', and never sees an excluded page at all: a marker
 * would survive in exactly the cases where the page asked for less publishing,
 * not more.
 *
 * @param {{ pathname: string }[]} rawPages
 * @param {ReturnType<typeof import('../sources/dist-html.js').createDistHtmlSource>} source
 * @param {ReturnType<typeof import('./artifacts.js').createArtifactWriter>} [writer]
 * @returns {number} files rewritten
 */
export function stripSourceMarkers(rawPages, source, writer) {
  let stripped = 0;
  for (const raw of rawPages) {
    const read = source.read(raw.pathname || '/');
    if (!read) continue;
    const { html, htmlPath } = read;
    // A substring test first: most pages have no marker, and this avoids running
    // the pattern over every byte of every page in the build.
    if (!html.includes('data-astro-aeo-marker') && !html.includes('data-astro-aeo-head')) continue;
    /** @param {string} value */
    const clean = (value) => stripAeoHeadMarkers(stripMarkersFromHtml(value));
    const cleaned = clean(html);
    if (cleaned === html) continue;
    const redactionWriter = /** @type {any} */ (writer);
    if (writer?.isDeferred && typeof redactionWriter.stageRedaction === 'function') {
      redactionWriter.stageRedaction(htmlPath, 'private-marker-redaction', clean);
    } else {
      writeFileSync(htmlPath, cleaned, 'utf8');
    }
    stripped++;
  }
  return stripped;
}
