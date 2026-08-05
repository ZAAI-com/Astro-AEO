// @ts-check

const MARKDOWN_TYPES = ['text/markdown', 'text/x-markdown'];
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
const PARAM_RE =
  /^([!#$%&'*+.^_`|~\w-]+)\s*=\s*([!#$%&'*+.^_`|~\w-]+|"(?:[\t !#-\[\]-~\x80-\uFFFF]|\\[\t !-~\x80-\uFFFF])*")$/;

/**
 * @typedef {object} AcceptEntry
 * @property {string} type
 * @property {number} q
 */

/**
 * @param {string | null | undefined} header
 * @returns {AcceptEntry[]}
 */
export function parseAccept(header) {
  if (!header || typeof header !== 'string') return [];
  const parts = splitOutsideQuotes(header, ',');
  if (!parts) return [];
  /** @type {AcceptEntry[]} */
  const entries = [];
  for (const part of parts) {
    const fields = splitOutsideQuotes(part, ';');
    if (!fields) return [];
    const [rawType, ...params] = fields;
    const type = rawType.trim().toLowerCase();
    if (!/^(?:\*|[!#$%&'*+.^_`|~\w-]+)\/(?:\*|[!#$%&'*+.^_`|~\w-]+)$/.test(type)) {
      return [];
    }

    let q = 1;
    let sawQ = false;
    for (const param of params) {
      const match = param.trim().match(PARAM_RE);
      if (!match) return [];
      const [, name, value] = match;
      if (name.toLowerCase() !== 'q') continue;

      const qValue = value.match(/^(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
      if (sawQ || !qValue) return [];
      sawQ = true;
      q = Number(qValue[1]);
    }
    entries.push({ type, q });
  }
  return entries;
}

/** @param {string} value @param {','|';'} delimiter @returns {string[] | null} */
function splitOutsideQuotes(value, delimiter) {
  /** @type {string[]} */
  const parts = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  return parts;
}

/**
 * @param {AcceptEntry[]} entries
 * @param {string[]} types
 * @returns {number} 0 when none is present.
 */
function scoreFor(entries, types) {
  return Math.max(0, ...types.map((type) => scoreForType(entries, type)));
}

/** @param {AcceptEntry[]} entries @param {string} type */
function scoreForType(entries, type) {
  const family = `${type.split('/')[0]}/*`;
  for (const candidate of [type, family, '*/*']) {
    const matches = entries.filter((entry) => entry.type === candidate);
    if (matches.length) return Math.max(...matches.map((entry) => entry.q));
  }
  return 0;
}

/** @param {string | null | undefined} header @returns {boolean} */
export function prefersMarkdown(header) {
  const entries = parseAccept(header);
  if (!entries.some((entry) => MARKDOWN_TYPES.includes(entry.type) && entry.q > 0)) return false;
  const markdown = scoreFor(entries, MARKDOWN_TYPES);
  if (markdown === 0) return false;
  return markdown > scoreFor(entries, HTML_TYPES);
}
