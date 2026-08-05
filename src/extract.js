// @ts-check
import { parseDocument } from './core/html-document.js';
import { extractMarkdown } from './core/extract/index.js';
import { createTurndown, DEFAULT_EXTRACTION } from './core/html-to-md.js';

export { DEFAULT_EXTRACTION } from './core/html-to-md.js';

/**
 * Extract a rendered HTML document through the same deterministic pipeline used
 * by build and request-time representations.
 *
 * @param {string} html
 * @param {import('./index.js').ExtractionOptions} [options]
 * @param {{ baseUrl?: string }} [context]
 * @returns {Promise<import('./extract.js').ExtractedDocument>}
 */
export async function extractHtml(html, options = {}, context = {}) {
  const extraction = {
    selectors: options.selectors ?? DEFAULT_EXTRACTION.selectors,
    removeSelectors: options.removeSelectors ?? DEFAULT_EXTRACTION.removeSelectors,
    keepSelectors: options.keepSelectors ?? DEFAULT_EXTRACTION.keepSelectors,
  };
  const result = extractMarkdown(
    parseDocument(html),
    extraction,
    await createTurndown(),
    context,
  );
  return { markdown: result.markdown, diagnostics: result.diagnostics };
}

/** @typedef {{ markdown: string; diagnostics: import('./index.js').ExtractionDiagnostics }} ExtractedDocument */
