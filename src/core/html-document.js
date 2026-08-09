// @ts-check
import { DOMParser } from 'linkedom/worker';

/**
 * The only module that knows which DOM implementation is in use.
 *
 * `linkedom/worker` is a single pre-bundled ESM file with no Node-specific APIs,
 * so the same code path serves the build, the dev server, and edge runtimes. Every
 * other module takes a `Document` and never imports a parser.
 */

/**
 * Parse an HTML document.
 *
 * Replaces the regular expression that used to slice `<main>` out of the source
 * text. That approach stopped at the first `</main>`, so a closing tag inside a
 * comment, a script string, or a `<template>` truncated the page, and it could
 * not express a selector at all.
 *
 * @param {string} html
 * @returns {Document}
 */
export function parseDocument(html) {
  // linkedom only makes a populated body for a complete HTML document. Astro
  // normally renders one, but callers can also supply a fragment (including an
  // empty string) while developing or rendering an on-demand route. Parse such
  // input in a synthetic document so every top-level sibling is retained.
  const normalized = html.slice(fragmentContentStart(html));
  if (/^<html(?:\s|>)/i.test(normalized)) {
    const complete = /** @type {any} */ (
      new DOMParser().parseFromString(normalized, 'text/html')
    );
    if (complete.documentElement && complete.body) return complete;
  }
  const document = /** @type {any} */ (
    new DOMParser().parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html')
  );
  // A doctype is only legal at the document level. Linkedom corrupts the tree
  // when one is assigned as fragment body HTML, so discard that non-content
  // token while retaining every actual top-level sibling.
  document.body.innerHTML = normalized;
  return document;
}

/**
 * Skip a fragment's non-content preamble without using a doctype regular
 * expression. PUBLIC and SYSTEM identifiers may legally contain `>`, and XML
 * processing instructions can precede otherwise useful HTML fragments.
 * @param {string} html
 * @returns {number}
 */
function fragmentContentStart(html) {
  let index = 0;
  while (index < html.length) {
    while (/\s/.test(html[index] ?? '')) index++;
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<?', index)) {
      const piEnd = html.indexOf('?>', index + 2);
      const fallbackEnd = html.indexOf('>', index + 2);
      const end = piEnd === -1 ? fallbackEnd : piEnd + 1;
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.slice(index, index + 9).toLowerCase() === '<!doctype') {
      let quote = '';
      let subsetDepth = 0;
      let cursor = index + 9;
      for (; cursor < html.length; cursor++) {
        const char = html[cursor];
        if (quote) {
          if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === '[') subsetDepth++;
        else if (char === ']' && subsetDepth > 0) subsetDepth--;
        else if (char === '>' && subsetDepth === 0) break;
      }
      index = cursor < html.length ? cursor + 1 : html.length;
      continue;
    }
    break;
  }
  return index;
}
