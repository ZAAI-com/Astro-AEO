// @ts-check

const MARKDOWN_OFFER = {
  type: 'text/markdown',
  parameters: [{ name: 'charset', value: 'utf-8' }],
};
const HTML_OFFERS = [
  { type: 'text/html', parameters: [] },
  { type: 'text/html', parameters: [{ name: 'charset', value: 'utf-8' }] },
  { type: 'application/xhtml+xml', parameters: [] },
  { type: 'application/xhtml+xml', parameters: [{ name: 'charset', value: 'utf-8' }] },
];
const PARAM_RE =
  /^([!#$%&'*+.^_`|~\w-]+)\s*=\s*([!#$%&'*+.^_`|~\w-]+|"(?:[\t !#-\[\]-~\x80-\uFFFF]|\\[\t !-~\x80-\uFFFF])*")$/;

/**
 * @typedef {object} AcceptEntry
 * @property {string} type
 * @property {{ name: string; value: string }[]} parameters
 * @property {number} q
 */

/** @typedef {{ type: string; parameters: { name: string; value: string }[] }} MediaOffer */

/**
 * @param {string | null | undefined} header
 * @returns {AcceptEntry[] | null} null when the header is malformed.
 */
export function parseAccept(header) {
  if (!header || typeof header !== 'string') return [];
  const parts = splitOutsideQuotes(header, ',');
  if (!parts) return null;
  /** @type {AcceptEntry[]} */
  const entries = [];
  for (const part of parts) {
    const fields = splitOutsideQuotes(part, ';');
    if (!fields) return null;
    const [rawType, ...params] = fields;
    const type = rawType.trim().toLowerCase();
    if (!isMediaRange(type)) {
      return null;
    }

    let q = 1;
    let sawQ = false;
    /** @type {{ name: string; value: string }[]} */
    const parameters = [];
    const names = new Set();
    for (const param of params) {
      const match = param.trim().match(PARAM_RE);
      if (!match) return null;
      const name = match[1].toLowerCase();
      const value = decodeParameterValue(match[2]);
      if (name !== 'q') {
        if (!sawQ) {
          if (names.has(name)) return null;
          names.add(name);
          parameters.push({ name, value });
        }
        continue;
      }

      const qValue = value.match(/^(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
      if (sawQ || !qValue || match[2].startsWith('"')) return null;
      sawQ = true;
      q = Number(qValue[1]);
    }
    entries.push({ type, parameters, q });
  }
  return entries;
}

/** @param {string} type @returns {boolean} */
function isMediaRange(type) {
  if (type === '*/*') return true;
  return /^[!#$%&'+.^_`|~\w-]+\/(?:[!#$%&'+.^_`|~\w-]+|\*)$/.test(type);
}

/** @param {string} value @returns {string} */
function decodeParameterValue(value) {
  if (!value.startsWith('"')) return value;
  return value.slice(1, -1).replace(/\\([\t !-~\x80-\uFFFF])/g, '$1');
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
 * @param {MediaOffer[]} offers
 * @returns {number} 0 when none is present.
 */
function scoreFor(entries, offers) {
  return Math.max(0, ...offers.map((offer) => scoreForOffer(entries, offer)));
}

/** @param {AcceptEntry[]} entries @param {MediaOffer} offer */
function scoreForOffer(entries, offer) {
  const matches = entries.filter((entry) => matchesOffer(entry, offer));
  if (!matches.length) return 0;
  const specificity = Math.max(...matches.map(entrySpecificity));
  const mostSpecific = matches.filter((entry) => entrySpecificity(entry) === specificity);
  return Math.max(...mostSpecific.map((entry) => entry.q));
}

/** @param {AcceptEntry} entry @param {MediaOffer} offer @returns {boolean} */
function matchesOffer(entry, offer) {
  const [offerFamily] = offer.type.split('/');
  if (entry.type !== '*/*' && entry.type !== `${offerFamily}/*` && entry.type !== offer.type) {
    return false;
  }
  return entry.parameters.every((required) => {
    const actual = offer.parameters.find((parameter) => parameter.name === required.name);
    if (!actual) return false;
    return required.name === 'charset'
      ? actual.value.toLowerCase() === required.value.toLowerCase()
      : actual.value === required.value;
  });
}

/** @param {AcceptEntry} entry @returns {number} */
function entrySpecificity(entry) {
  const type = entry.type === '*/*' ? 0 : entry.type.endsWith('/*') ? 1 : 2;
  return type * 1000 + entry.parameters.length;
}

/** @param {string | null | undefined} header @returns {boolean} */
export function prefersMarkdown(header) {
  const entries = parseAccept(header);
  if (!entries) return false;
  if (!entries.some((entry) => entry.type === MARKDOWN_OFFER.type && entry.q > 0 && matchesOffer(entry, MARKDOWN_OFFER))) {
    return false;
  }
  const markdown = scoreFor(entries, [MARKDOWN_OFFER]);
  if (markdown === 0) return false;
  return markdown > scoreFor(entries, HTML_OFFERS);
}
