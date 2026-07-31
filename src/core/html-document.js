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
  return /** @type {any} */ (new DOMParser()).parseFromString(html, 'text/html');
}
