// @ts-check

/**
 * @typedef {object} PageMeta
 * @property {string} title            Title with any configured suffix stripped.
 * @property {string} description      Meta description, or empty string.
 * @property {boolean} noindex         True if <meta name="robots"> contains "noindex".
 * @property {Set<string>} aeoTokens   Tokens from <meta name="aeo" content="...">.
 * @property {Date | undefined} modifiedTime  Parsed <meta property="article:modified_time">.
 * @property {boolean} isRedirect      True if the page looks like a redirect stub.
 */

/**
 * Build a title-suffix stripper from the configured option.
 * @param {string | string[] | RegExp | false | undefined} suffix
 * @returns {(title: string) => string}
 */
export function makeTitleStripper(suffix) {
  if (!suffix) return (t) => t;
  if (suffix instanceof RegExp) return (t) => t.replace(suffix, '').trim();
  const list = Array.isArray(suffix) ? suffix : [suffix];
  const escaped = list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Strip a trailing separator (pipe, hyphen, en dash, em dash, or middot) plus suffix.
  const re = new RegExp(`\\s*[|\\-\\u2013\\u2014\\u00b7]\\s*(?:${escaped.join('|')})\\s*$`);
  return (t) => t.replace(re, '').trim();
}

/**
 * Extract the <title> text, with the given stripper applied.
 * @param {string} html
 * @param {(title: string) => string} [strip]
 * @returns {string}
 */
export function extractTitle(html, strip = (t) => t) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? strip(decodeEntities(match[1].trim())) : '';
}

/**
 * Extract a quoted content value from a matching <meta> tag.
 * @param {string} html
 * @param {{ name?: string; property?: string }} query
 * @returns {string | undefined}
 */
export function extractMetaContent(html, query) {
  const targetName = query.name?.toLowerCase();
  const targetProperty = query.property?.toLowerCase();
  if (!targetName && !targetProperty) return undefined;

  const tagRe = /<meta\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html))) {
    const attrs = extractQuotedAttributes(tagMatch[0]);
    const name = attrs.get('name')?.toLowerCase();
    const property = attrs.get('property')?.toLowerCase();
    const matchesName = targetName ? name === targetName : false;
    const matchesProperty = targetProperty ? property === targetProperty : false;
    if (matchesName || matchesProperty) {
      const content = attrs.get('content');
      return content === undefined ? '' : decodeEntities(content);
    }
  }
  return undefined;
}

/**
 * Extract the meta description.
 * @param {string} html
 * @returns {string}
 */
export function extractDescription(html) {
  const match = html.match(
    /<meta\s+[^>]*name=(["'])description\1[^>]*content=(["'])([\s\S]*?)\2/i,
  );
  if (match) return decodeEntities(match[3]);
  // content may precede name. Keep the capture within a single tag ([^>]*?) so
  // it cannot bleed from an earlier meta tag's content= attribute.
  const alt = html.match(
    /<meta\s+[^>]*content=(["'])([^>]*?)\1[^>]*name=(["'])description\3/i,
  );
  return alt ? decodeEntities(alt[2]) : '';
}

/**
 * Read the space-separated tokens from <meta name="aeo" content="...">.
 * @param {string} html
 * @returns {Set<string>}
 */
export function extractAeoTokens(html) {
  const match = html.match(/<meta\s+[^>]*name=(["'])aeo\1[^>]*content=(["'])([\s\S]*?)\2/i);
  if (!match) return new Set();
  return new Set(
    match[3]
      .split(/[\s,]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * True when the page carries a noindex robots directive.
 * @param {string} html
 * @returns {boolean}
 */
export function extractNoindex(html) {
  const match = html.match(/<meta\s+[^>]*name=(["'])robots\1[^>]*content=(["'])([\s\S]*?)\2/i);
  return match ? /\bnoindex\b/i.test(match[3]) : false;
}

/**
 * Parse <meta property="article:modified_time"> (or name= variant) into a Date.
 * @param {string} html
 * @returns {Date | undefined}
 */
export function extractModifiedTime(html) {
  const match = html.match(
    /<meta\s+[^>]*(?:property|name)=(["'])article:modified_time\1[^>]*content=(["'])([\s\S]*?)\2/i,
  );
  if (!match) return undefined;
  const d = new Date(match[3].trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * A page is treated as a redirect stub when it declares a meta refresh.
 * @param {string} html
 * @returns {boolean}
 */
export function isRedirectStub(html) {
  return /<meta\s+[^>]*http-equiv=(["'])refresh\1/i.test(html);
}

/**
 * Collect all AEO-relevant metadata from a built HTML document.
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
 * Decode the small set of named HTML entities that show up in titles and
 * descriptions. Deliberately narrow; content bodies go through Turndown.
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
  // Decode `&amp;` LAST so an escaped entity like `&amp;lt;` (literal "&lt;")
  // is not double-decoded into "<".
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
function extractQuotedAttributes(tag) {
  const attrs = new Map();
  const attrRe = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRe.exec(tag))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? '');
  }
  return attrs;
}
