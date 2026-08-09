// @ts-check

/**
 * @typedef {object} PageMeta
 * @property {string} title
 * @property {string} description
 * @property {boolean} noindex
 * @property {Set<string>} aeoTokens
 * @property {Date | undefined} modifiedTime
 * @property {boolean} isRedirect
 */

/**
 * @param {string | string[] | RegExp | false | undefined} suffix
 * @returns {(title: string) => string}
 */
export function makeTitleStripper(suffix) {
  if (!suffix) return (t) => t;
  if (suffix instanceof RegExp) return (t) => t.replace(suffix, '').trim();
  const list = Array.isArray(suffix) ? suffix : [suffix];
  const escaped = list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\s*[|\\-\\u2013\\u2014\\u00b7]\\s*(?:${escaped.join('|')})\\s*$`);
  return (t) => t.replace(re, '').trim();
}

/**
 * @param {string} html
 * @param {(title: string) => string} [strip]
 * @returns {string}
 */
export function extractTitle(html, strip = (t) => t) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? strip(decodeEntities(match[1].trim())) : '';
}

/**
 * @param {string} html
 * @param {{ name?: string; property?: string }} query
 * @returns {string | undefined}
 */
export function extractMetaContent(html, query) {
  const targetName = query.name?.toLowerCase();
  const targetProperty = query.property?.toLowerCase();
  if (!targetName && !targetProperty) return undefined;

  for (const attrs of eachMetaTag(html)) {
    const name = attrs.get('name')?.toLowerCase();
    const property = attrs.get('property')?.toLowerCase();
    const matchesName = targetName ? name === targetName : false;
    const matchesProperty = targetProperty ? property === targetProperty : false;
    if (matchesName || matchesProperty) {
      const content = attrs.get('content');
      return content === undefined ? undefined : decodeEntities(content);
    }
  }
  return undefined;
}

/**
 * @param {string} html
 * @returns {Generator<Map<string, string>>}
 */
function* eachMetaTag(html) {
  const tagRe = /<meta\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html))) {
    yield extractAttributes(tagMatch[0]);
  }
}

/**
 * @param {string} html
 * @returns {string}
 */
export function extractDescription(html) {
  return extractMetaContent(html, { name: 'description' }) ?? '';
}

/**
 * @param {string} html
 * @returns {Set<string>}
 */
export function extractAeoTokens(html) {
  const content = extractMetaContent(html, { name: 'aeo' });
  if (content === undefined) return new Set();
  return new Set(
    content
      .split(/[\s,]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function extractNoindex(html) {
  const content = extractMetaContent(html, { name: 'robots' });
  return content === undefined ? false : /\bnoindex\b/i.test(content);
}

/**
 * @param {string} html
 * @returns {Date | undefined}
 */
export function extractModifiedTime(html) {
  const content = extractMetaContent(html, {
    property: 'article:modified_time',
    name: 'article:modified_time',
  });
  if (content === undefined) return undefined;
  const d = new Date(content.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isRedirectStub(html) {
  for (const attrs of eachMetaTag(html)) {
    if (attrs.get('http-equiv')?.toLowerCase() === 'refresh') return true;
  }
  return false;
}

/**
 * @param {string} html
 * @param {(title: string) => string} [strip]
 * @returns {PageMeta}
 */
export function extractPageMeta(html, strip = (t) => t) {
  return {
    title: extractTitle(html, strip),
    description: extractDescription(html),
    noindex: extractNoindex(html),
    aeoTokens: extractAeoTokens(html),
    modifiedTime: extractModifiedTime(html),
    isRedirect: isRedirectStub(html),
  };
}

/**
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * @param {string} tag
 * @returns {Map<string, string>}
 */
function extractAttributes(tag) {
  const attrs = new Map();
  const attrRe = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = attrRe.exec(tag))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}
