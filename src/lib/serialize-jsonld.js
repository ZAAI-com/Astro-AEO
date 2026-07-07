// @ts-check

// U+2028 (line separator) and U+2029 (paragraph separator) are valid in JSON
// strings but terminate inline <script> content, so they must be escaped.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
const LINE_SEP_RE = new RegExp(LINE_SEP, 'g');
const PARA_SEP_RE = new RegExp(PARA_SEP, 'g');

/**
 * Serialize a value for safe embedding inside a <script type="application/ld+json">
 * block. Escapes "<" and the U+2028 / U+2029 line separators.
 * @param {unknown} value
 * @returns {string}
 */
export function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP_RE, '\\u2028')
    .replace(PARA_SEP_RE, '\\u2029');
}
