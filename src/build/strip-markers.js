// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { stripMarkersFromHtml } from '../core/extract/marker.js';

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
 * @returns {number} files rewritten
 */
export function stripSourceMarkers(rawPages, source) {
  let stripped = 0;
  for (const raw of rawPages) {
    const htmlPath = source.htmlPathFor(raw.pathname || '/');
    let html;
    try {
      html = readFileSync(htmlPath, 'utf8');
    } catch {
      continue;
    }
    // A substring test first: most pages have no marker, and this avoids running
    // the pattern over every byte of every page in the build.
    if (!html.includes('data-astro-aeo-marker')) continue;
    const cleaned = stripMarkersFromHtml(html);
    if (cleaned === html) continue;
    writeFileSync(htmlPath, cleaned, 'utf8');
    stripped++;
  }
  return stripped;
}
