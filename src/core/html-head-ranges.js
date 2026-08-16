// @ts-check

const RAW_TEXT_NAMES = new Set(['script', 'style', 'template', 'noscript', 'title', 'textarea']);

/**
 * Locate the first real HTML head while skipping comments and raw-text
 * elements. Returned offsets point into the original string, so callers can
 * apply targeted edits without serializing unrelated bytes.
 *
 * @param {string} html
 * @returns {{ openStart: number; contentStart: number; contentEnd: number; closeEnd: number } | null}
 */
export function findHeadBounds(html) {
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start === -1) return null;
    if (html.startsWith('<!--', start)) {
      cursor = commentEnd(html, start);
      continue;
    }
    const tag = readTag(html, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }
    if (!tag.closing && tag.name === 'head') {
      const close = findClosingHead(html, tag.end);
      return close === null
        ? null
        : { openStart: start, contentStart: tag.end, contentEnd: close.start, closeEnd: close.end };
    }
    cursor = skipRawElement(html, tag) ?? tag.end;
  }
  return null;
}

/** @param {string} html */
export function hasHtmlHead(html) {
  return findHeadBounds(html) !== null;
}

/**
 * Return actual opening tags from the real head. Tag-like text inside JSON-LD,
 * scripts, styles, templates, comments, and title text is never returned.
 *
 * @param {string} html
 * @param {string} name
 * @returns {string[]}
 */
export function headTagSources(html, name) {
  const wanted = name.toLowerCase();
  return scanHead(html).filter((tag) => !tag.closing && tag.name === wanted).map((tag) => tag.source);
}

/**
 * Remove matching real head tags while retaining every unrelated byte.
 * `paired` removes the complete raw-text element (used for title).
 *
 * @param {string} html
 * @param {string} name
 * @param {(tag: string) => boolean} predicate
 * @param {boolean} [paired]
 */
export function removeHeadTags(html, name, predicate, paired = false) {
  const wanted = name.toLowerCase();
  const edits = scanHead(html).flatMap((tag) =>
    !tag.closing && tag.name === wanted && predicate(tag.source)
      ? [{ start: tag.start, end: paired ? tag.elementEnd : tag.end }]
      : [],
  );
  let output = html;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}${output.slice(edit.end)}`;
  }
  return output;
}

/** @param {string} html @param {string} addition */
export function insertIntoHead(html, addition) {
  if (!addition) return html;
  const bounds = findHeadBounds(html);
  if (!bounds) return html;
  return `${html.slice(0, bounds.contentEnd)}${addition}${html.slice(bounds.contentEnd)}`;
}

/**
 * Replace the first matching real head tag.
 *
 * @param {string} html
 * @param {string} name
 * @param {(tag: string) => boolean} predicate
 * @param {string} replacement
 */
export function replaceHeadTag(html, name, predicate, replacement) {
  const wanted = name.toLowerCase();
  const tag = scanHead(html).find((candidate) =>
    !candidate.closing && candidate.name === wanted && predicate(candidate.source),
  );
  if (!tag) return html;
  return `${html.slice(0, tag.start)}${replacement}${html.slice(tag.end)}`;
}

/**
 * Return real elements from the complete HTML document while skipping comments
 * and tag-like text inside raw-text elements. Offsets always address the
 * original input, allowing internal marker scripts to be removed without
 * parsing and serializing the surrounding document.
 *
 * @param {string} html
 * @param {string} name
 * @returns {{ start: number; openEnd: number; contentEnd: number; end: number; source: string; content: string }[]}
 */
export function htmlElementRanges(html, name) {
  const wanted = name.toLowerCase();
  const ranges = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      cursor = commentEnd(html, start);
      continue;
    }
    const tag = readTag(html, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }
    const raw = rawElementBounds(html, tag);
    if (!tag.closing && tag.name === wanted) {
      ranges.push({
        start: tag.start,
        openEnd: tag.end,
        contentEnd: raw?.contentEnd ?? tag.end,
        end: raw?.end ?? tag.end,
        source: html.slice(tag.start, tag.end),
        content: raw ? html.slice(tag.end, raw.contentEnd) : '',
      });
    }
    cursor = raw?.end ?? tag.end;
  }
  return ranges;
}

/**
 * Remove selected real elements from the complete HTML document.
 *
 * @param {string} html
 * @param {string} name
 * @param {(element: { source: string; content: string }) => boolean} predicate
 */
export function removeHtmlElements(html, name, predicate) {
  const edits = htmlElementRanges(html, name).filter(predicate);
  let output = html;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}${output.slice(edit.end)}`;
  }
  return output;
}

/**
 * Read one opening-tag attribute without mistaking text inside another quoted
 * attribute value for an attribute. Boolean attributes return an empty string.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string | undefined}
 */
export function htmlTagAttribute(source, name) {
  const prefix = source.match(/^<\s*\/?\s*[A-Za-z][A-Za-z\d:-]*/);
  if (!prefix) return undefined;
  const wanted = name.toLowerCase();
  let cursor = prefix[0].length;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    if (source[cursor] === '>' || source[cursor] === '/') return undefined;
    const start = cursor;
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor++;
    if (cursor === start) {
      cursor++;
      continue;
    }
    const attribute = source.slice(start, cursor).toLowerCase();
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    let value = '';
    if (source[cursor] === '=') {
      cursor++;
      while (/\s/.test(source[cursor] ?? '')) cursor++;
      const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : '';
      const valueStart = cursor;
      if (quote) {
        while (cursor < source.length && source[cursor] !== quote) cursor++;
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor++;
      } else {
        while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor++;
        value = source.slice(valueStart, cursor);
      }
    }
    if (attribute === wanted) return value;
  }
  return undefined;
}

/**
 * @typedef {{ name: string; closing: boolean; start: number; end: number; elementEnd: number; source: string }} HeadTag
 */

/** @param {string} html @returns {HeadTag[]} */
function scanHead(html) {
  const bounds = findHeadBounds(html);
  if (!bounds) return [];
  /** @type {HeadTag[]} */
  const tags = [];
  let cursor = bounds.contentStart;
  while (cursor < bounds.contentEnd) {
    const start = html.indexOf('<', cursor);
    if (start === -1 || start >= bounds.contentEnd) break;
    if (html.startsWith('<!--', start)) {
      cursor = Math.min(commentEnd(html, start), bounds.contentEnd);
      continue;
    }
    const tag = readTag(html, start);
    if (!tag || tag.end > bounds.contentEnd) {
      cursor = start + 1;
      continue;
    }
    const rawEnd = skipRawElement(html, tag, bounds.contentEnd);
    tags.push({
      ...tag,
      elementEnd: rawEnd ?? tag.end,
      source: html.slice(tag.start, tag.end),
    });
    cursor = rawEnd ?? tag.end;
  }
  return tags;
}

/** @param {string} html @param {number} start */
function commentEnd(html, start) {
  const end = html.indexOf('-->', start + 4);
  return end === -1 ? html.length : end + 3;
}

/**
 * @param {string} html
 * @param {number} start
 * @returns {{ name: string; closing: boolean; start: number; end: number } | null}
 */
function readTag(html, start) {
  const prefix = html.slice(start).match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z\d:-]*)\b/);
  if (!prefix) return null;
  const end = tagEnd(html, start + prefix[0].length);
  if (end === -1) return null;
  return {
    name: prefix[2].toLowerCase(),
    closing: prefix[1] === '/',
    start,
    end: end + 1,
  };
}

/** @param {string} html @param {number} from */
function tagEnd(html, from) {
  let quote = '';
  for (let index = from; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

/**
 * @param {string} html
 * @param {{ name: string; closing: boolean; start: number; end: number }} tag
 * @param {number} [limit]
 * @returns {number | null}
 */
function skipRawElement(html, tag, limit = html.length) {
  return rawElementBounds(html, tag, limit)?.end ?? null;
}

/**
 * @param {string} html
 * @param {{ name: string; closing: boolean; start: number; end: number }} tag
 * @param {number} [limit]
 */
function rawElementBounds(html, tag, limit = html.length) {
  if (tag.closing || !RAW_TEXT_NAMES.has(tag.name) || /\/\s*>$/.test(html.slice(tag.start, tag.end))) {
    return null;
  }
  const close = new RegExp(`<\\/\\s*${escapeRegExp(tag.name)}\\s*>`, 'ig');
  close.lastIndex = tag.end;
  const match = close.exec(html);
  if (!match || match.index >= limit) return { contentEnd: limit, end: limit };
  return { contentEnd: match.index, end: match.index + match[0].length };
}

/** @param {string} html @param {number} from */
function findClosingHead(html, from) {
  let cursor = from;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start === -1) return null;
    if (html.startsWith('<!--', start)) {
      cursor = commentEnd(html, start);
      continue;
    }
    const tag = readTag(html, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }
    if (tag.closing && tag.name === 'head') return { start, end: tag.end };
    cursor = skipRawElement(html, tag) ?? tag.end;
  }
  return null;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
