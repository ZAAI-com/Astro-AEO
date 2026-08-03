// @ts-check
import TurndownService from 'turndown';
import { parseDocument } from './html-document.js';
import { addKeepRule, extractMarkdown, NEVER_CONTENT } from './extract/index.js';

/**
 * Create a configured Turndown instance. One per build so future options can
 * influence the conversion without leaking module-level state between runs.
 * @returns {import('turndown')}
 */
export function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  // Extraction already strips these from the document, so this is a second line
  // of defence for any caller that hands Turndown raw HTML directly.
  td.remove(/** @type {any} */ (NEVER_CONTENT));

  return addKeepRule(td);
}

/**
 * Convert a rendered page to Markdown using the configured extraction options.
 * @param {string} html
 * @param {import('../core/extract/index.js').ExtractionOptions} extraction
 * @param {import('turndown')} [td]
 * @param {{ baseUrl?: string }} [context]
 * @returns {{ markdown: string; diagnostics: import('../core/extract/index.js').ExtractionDiagnostics }}
 */
export function htmlToMarkdownWithDiagnostics(html, extraction, td = createTurndown(), context = {}) {
  return extractMarkdown(parseDocument(html), extraction, td, context);
}

/**
 * Convert an HTML document to Markdown with the default extraction options.
 * Retained because it is the established entry point; prefer
 * `htmlToMarkdownWithDiagnostics` where the configured options are available.
 * @param {string} html
 * @param {import('turndown')} [td]
 * @returns {string}
 */
export function htmlToMarkdown(html, td = createTurndown()) {
  return htmlToMarkdownWithDiagnostics(html, DEFAULT_EXTRACTION, td).markdown;
}

/**
 * The shipped defaults. `article` before `main` prefers the semantic content
 * element when a page has one; `nav` and `footer` used to be dropped by a
 * hard-coded Turndown rule and are now ordinary, overridable selectors.
 * @type {import('../core/extract/index.js').ExtractionOptions}
 */
export const DEFAULT_EXTRACTION = {
  selectors: ['article', 'main'],
  removeSelectors: ['nav', 'footer'],
  keepSelectors: [],
};
