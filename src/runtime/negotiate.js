// @ts-check

/**
 * Accept-header negotiation.
 *
 * Deliberately conservative. Getting this wrong means serving Markdown to a
 * browser, so every ambiguous case resolves to HTML: a missing header, a
 * malformed one, a wildcard-only one, and a tie. Markdown has to be asked for
 * explicitly and has to outrank HTML strictly.
 */

const MARKDOWN_TYPES = ['text/markdown', 'text/x-markdown'];
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

/**
 * @typedef {object} AcceptEntry
 * @property {string} type
 * @property {number} q
 */

/**
 * Parse an Accept header into media types with q-values.
 *
 * A malformed entry is dropped rather than defaulted, because a header we cannot
 * read is not evidence of what the client wants.
 *
 * @param {string | null | undefined} header
 * @returns {AcceptEntry[]}
 */
export function parseAccept(header) {
  if (!header || typeof header !== 'string') return [];
  /** @type {AcceptEntry[]} */
  const entries = [];
  for (const part of header.split(',')) {
    const [rawType, ...params] = part.split(';');
    const type = rawType.trim().toLowerCase();
    if (!type || !type.includes('/')) continue;

    let q = 1;
    for (const param of params) {
      const [name, value] = param.split('=');
      if (name?.trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat(value ?? '');
      // A q outside 0..1 is invalid per the grammar; treat the entry as unusable
      // rather than clamping it into a preference the client never expressed.
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        q = Number.NaN;
        break;
      }
      q = parsed;
    }
    if (Number.isNaN(q)) continue;
    entries.push({ type, q });
  }
  return entries;
}

/**
 * The best q-value among a set of exact media types. Wildcards deliberately do
 * not count: `*​/*` is a client saying it has no preference, not a client asking
 * for Markdown.
 * @param {AcceptEntry[]} entries
 * @param {string[]} types
 * @returns {number} 0 when none is present.
 */
function scoreFor(entries, types) {
  let best = 0;
  for (const entry of entries) {
    if (types.includes(entry.type) && entry.q > best) best = entry.q;
  }
  return best;
}

/**
 * Whether the client explicitly prefers Markdown over HTML.
 *
 * @param {string | null | undefined} header
 * @returns {boolean}
 */
export function prefersMarkdown(header) {
  const entries = parseAccept(header);
  const markdown = scoreFor(entries, MARKDOWN_TYPES);
  if (markdown === 0) return false;
  // Strictly greater: a tie means the client is equally happy with HTML, and HTML
  // is what a browser can actually display.
  return markdown > scoreFor(entries, HTML_TYPES);
}
