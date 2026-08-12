// @ts-check

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * @typedef {{ code: string; message: string }} SitemapXmlFinding
 * @typedef {{ loc: string; alternates: { language: string; url: string }[] }} SitemapUrlEntry
 * @typedef {{ kind: 'index'; locations: string[]; urls: never[]; findings: SitemapXmlFinding[] } | { kind: 'urlset'; locations: never[]; urls: SitemapUrlEntry[]; findings: SitemapXmlFinding[] } | { kind: null; locations: never[]; urls: never[]; findings: SitemapXmlFinding[] }} ParsedSitemapXml
 */

/**
 * Strictly parse the XML subset used by the sitemap protocol. This deliberately
 * does not use an HTML-style parser: those parsers repair malformed XML and can
 * make a broken sitemap appear valid.
 *
 * Unknown extension elements are retained by the XML stack but ignored by the
 * sitemap projection. DTDs and entity declarations are rejected.
 *
 * @param {string} source
 * @returns {ParsedSitemapXml}
 */
export function parseSitemapXml(source) {
  /** @type {SitemapXmlFinding[]} */
  const findings = [];
  let root;
  try {
    root = parseXml(source);
  } catch (error) {
    findings.push({
      code: 'sitemap-xml-malformed',
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: null, locations: [], urls: [], findings };
  }

  const rootName = localName(root.name);
  if (rootName !== 'sitemapindex' && rootName !== 'urlset') {
    findings.push({
      code: 'sitemap-root-invalid',
      message: 'A sitemap document root must be <sitemapindex> or <urlset>.',
    });
    return { kind: null, locations: [], urls: [], findings };
  }

  const namespaces = namespaceMap(root);
  if (namespaceFor(root.name, namespaces) !== SITEMAP_NAMESPACE) {
    findings.push({
      code: 'sitemap-namespace-invalid',
      message: `The sitemap root must use the ${SITEMAP_NAMESPACE} namespace.`,
    });
  }

  if (rootName === 'sitemapindex') {
    /** @type {string[]} */
    const locations = [];
    for (const child of elementChildren(root)) {
      if (!isSitemapElement(child, 'sitemap', namespaces)) continue;
      const locs = elementChildren(child).filter((entry) => isSitemapElement(entry, 'loc', namespaces));
      if (locs.length !== 1 || elementChildren(locs[0]).length > 0 || !nodeText(locs[0]).trim()) {
        findings.push({
          code: 'sitemap-index-loc-invalid',
          message: 'Each <sitemap> entry must contain exactly one non-empty <loc>.',
        });
        continue;
      }
      locations.push(nodeText(locs[0]).trim());
    }
    if (locations.length === 0) {
      findings.push({
        code: 'sitemap-index-empty',
        message: 'A sitemap index must contain at least one valid <sitemap> entry.',
      });
    }
    return { kind: 'index', locations, urls: [], findings };
  }

  /** @type {SitemapUrlEntry[]} */
  const urls = [];
  for (const child of elementChildren(root)) {
    if (!isSitemapElement(child, 'url', namespaces)) continue;
    const locs = elementChildren(child).filter((entry) => isSitemapElement(entry, 'loc', namespaces));
    if (locs.length !== 1 || elementChildren(locs[0]).length > 0 || !nodeText(locs[0]).trim()) {
      findings.push({
        code: 'sitemap-url-loc-invalid',
        message: 'Each <url> entry must contain exactly one non-empty <loc>.',
      });
      continue;
    }

    /** @type {{ language: string; url: string }[]} */
    const alternates = [];
    const languages = new Set();
    for (const entry of elementChildren(child)) {
      if (localName(entry.name) !== 'link' || namespaceFor(entry.name, namespaces) !== XHTML_NAMESPACE) continue;
      const rel = entry.attrs.get('rel')?.trim().toLowerCase();
      if (rel !== 'alternate') continue;
      const language = canonicalLanguage(entry.attrs.get('hreflang'));
      const url = entry.attrs.get('href')?.trim();
      if (!language || !url) {
        findings.push({
          code: 'sitemap-hreflang-invalid',
          message: 'Every xhtml:link alternate needs a valid hreflang and non-empty href.',
        });
        continue;
      }
      if (languages.has(language)) {
        findings.push({
          code: 'sitemap-hreflang-duplicate',
          message: `A sitemap URL entry contains more than one ${language} alternate.`,
        });
        continue;
      }
      languages.add(language);
      alternates.push({ language, url });
    }
    urls.push({ loc: nodeText(locs[0]).trim(), alternates });
  }
  if (urls.length === 0) {
    findings.push({
      code: 'sitemap-urlset-empty',
      message: 'A sitemap URL set must contain at least one valid <url> entry.',
    });
  }
  return { kind: 'urlset', locations: [], urls, findings };
}

/** @typedef {{ name: string; attrs: Map<string, string>; children: Array<XmlNode | string> }} XmlNode */

/**
 * @param {string} raw
 * @returns {XmlNode}
 */
function parseXml(raw) {
  const source = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  for (const character of source) {
    if (!validXmlCodePoint(/** @type {number} */ (character.codePointAt(0)))) {
      fail(0, 'The document contains a character forbidden by XML 1.0.');
    }
  }
  /** @type {XmlNode[]} */
  const stack = [];
  /** @type {XmlNode | undefined} */
  let root;
  let position = 0;
  let declarationSeen = false;

  const appendText = (/** @type {string} */ text, /** @type {boolean} */ cdata = false) => {
    if (!text) return;
    const value = cdata ? text : decodeXmlEntities(text);
    if (stack.length === 0) {
      if (value.trim()) fail(position, 'Text is not allowed outside the document element.');
      return;
    }
    stack[stack.length - 1].children.push(value);
  };

  while (position < source.length) {
    const open = source.indexOf('<', position);
    if (open === -1) {
      appendText(source.slice(position));
      position = source.length;
      break;
    }
    appendText(source.slice(position, open));
    position = open;

    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      if (end === -1) fail(position, 'An XML comment is not closed.');
      if (source.slice(position + 4, end).includes('--')) fail(position, 'An XML comment contains "--".');
      position = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', position)) {
      if (stack.length === 0) fail(position, 'CDATA is not allowed outside the document element.');
      const end = source.indexOf(']]>', position + 9);
      if (end === -1) fail(position, 'A CDATA section is not closed.');
      appendText(source.slice(position + 9, end), true);
      position = end + 3;
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(source.slice(position))) {
      fail(position, 'DOCTYPE declarations are not allowed in sitemaps.');
    }
    if (source.startsWith('<?', position)) {
      const end = source.indexOf('?>', position + 2);
      if (end === -1) fail(position, 'A processing instruction is not closed.');
      const body = source.slice(position + 2, end).trim();
      if (!/^xml(?:\s|$)/i.test(body) || declarationSeen || root || stack.length) {
        fail(position, 'Only one leading XML declaration is allowed.');
      }
      if (!/^xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])UTF-8\2)?\s*$/i.test(body)) {
        fail(position, 'The XML declaration must specify version 1.0 and optional UTF-8 encoding.');
      }
      declarationSeen = true;
      position = end + 2;
      continue;
    }
    if (source.startsWith('</', position)) {
      const end = source.indexOf('>', position + 2);
      if (end === -1) fail(position, 'A closing tag is not closed.');
      const name = source.slice(position + 2, end).trim();
      if (!validXmlName(name)) fail(position, 'A closing tag has an invalid XML name.');
      const current = stack.pop();
      if (!current || current.name !== name) {
        fail(position, `Closing tag </${name}> does not match the open element.`);
      }
      position = end + 1;
      continue;
    }
    if (source.startsWith('<!', position)) fail(position, 'Unsupported XML declaration.');

    const end = findTagEnd(source, position + 1);
    if (end === -1) fail(position, 'An opening tag is not closed.');
    let body = source.slice(position + 1, end).trim();
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1).trimEnd();
    const parsed = parseOpeningTag(body, position);
    /** @type {XmlNode} */
    const node = { name: parsed.name, attrs: parsed.attrs, children: [] };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else if (root) fail(position, 'An XML document may contain only one root element.');
    else root = node;
    if (!selfClosing) stack.push(node);
    position = end + 1;
  }

  if (stack.length > 0) fail(source.length, `Element <${stack.at(-1)?.name}> is not closed.`);
  if (!root) fail(0, 'The XML document has no root element.');
  return root;
}

/** @param {string} body @param {number} offset */
function parseOpeningTag(body, offset) {
  const nameMatch = body.match(/^([^\s/>]+)/);
  if (!nameMatch || !validXmlName(nameMatch[1])) fail(offset, 'An opening tag has an invalid XML name.');
  const name = nameMatch[1];
  /** @type {Map<string, string>} */
  const attrs = new Map();
  let position = name.length;
  while (position < body.length) {
    const whitespace = body.slice(position).match(/^\s+/);
    if (!whitespace) fail(offset + position, 'Attributes must be separated by whitespace.');
    position += whitespace[0].length;
    if (position >= body.length) break;
    const attrMatch = body.slice(position).match(/^([^\s=/>]+)/);
    if (!attrMatch || !validXmlName(attrMatch[1])) fail(offset + position, 'An attribute has an invalid XML name.');
    const attrName = attrMatch[1];
    position += attrName.length;
    const equals = body.slice(position).match(/^\s*=\s*/);
    if (!equals) fail(offset + position, `Attribute ${attrName} has no quoted value.`);
    position += equals[0].length;
    const quote = body[position];
    if (quote !== '"' && quote !== "'") fail(offset + position, `Attribute ${attrName} has no quoted value.`);
    const valueEnd = body.indexOf(quote, position + 1);
    if (valueEnd === -1) fail(offset + position, `Attribute ${attrName} is not closed.`);
    if (attrs.has(attrName)) fail(offset + position, `Attribute ${attrName} is duplicated.`);
    const rawValue = body.slice(position + 1, valueEnd);
    if (rawValue.includes('<')) fail(offset + position, `Attribute ${attrName} contains an unescaped "<".`);
    attrs.set(attrName, decodeXmlEntities(rawValue));
    position = valueEnd + 1;
  }
  return { name, attrs };
}

/** @param {string} source @param {number} start */
function findTagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    } else if (char === '<') {
      return -1;
    }
  }
  return -1;
}

/** @param {string} value */
function decodeXmlEntities(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|[0-9]+));)/i.test(value)) {
    throw new Error('A bare or unknown ampersand sequence is not valid XML.');
  }
  return value.replace(/&([^;]+);/g, (_match, entity) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const numeric = entity.match(/^#(x[0-9a-f]+|[0-9]+)$/i);
    if (!numeric) throw new Error(`Unknown XML entity &${entity};.`);
    const codePoint = numeric[1][0].toLowerCase() === 'x'
      ? Number.parseInt(numeric[1].slice(1), 16)
      : Number.parseInt(numeric[1], 10);
    if (!validXmlCodePoint(codePoint)) throw new Error(`Invalid XML character reference &${entity};.`);
    return String.fromCodePoint(codePoint);
  });
}

/** @param {number} value */
function validXmlCodePoint(value) {
  return value === 0x9 || value === 0xa || value === 0xd ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff);
}

/** @param {string} name */
function validXmlName(name) {
  return /^(?:[A-Za-z_][\w.-]*)(?::[A-Za-z_][\w.-]*)?$/.test(name);
}

/** @param {XmlNode} node */
function namespaceMap(node) {
  const namespaces = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]);
  for (const [name, value] of node.attrs) {
    if (name === 'xmlns') namespaces.set('', value);
    else if (name.startsWith('xmlns:')) namespaces.set(name.slice(6), value);
  }
  return namespaces;
}

/** @param {string} name @param {Map<string, string>} namespaces */
function namespaceFor(name, namespaces) {
  const colon = name.indexOf(':');
  return namespaces.get(colon === -1 ? '' : name.slice(0, colon));
}

/** @param {XmlNode} node @param {string} name @param {Map<string, string>} namespaces */
function isSitemapElement(node, name, namespaces) {
  return localName(node.name) === name && namespaceFor(node.name, namespaces) === SITEMAP_NAMESPACE;
}

/** @param {string} name */
function localName(name) {
  return name.slice(name.indexOf(':') + 1);
}

/** @param {XmlNode} node @returns {XmlNode[]} */
function elementChildren(node) {
  return /** @type {XmlNode[]} */ (node.children.filter((child) => typeof child !== 'string'));
}

/** @param {XmlNode} node @returns {string} */
function nodeText(node) {
  return node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('');
}

/** @param {unknown} value */
function canonicalLanguage(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().replace(/_/g, '-');
  if (candidate.toLowerCase() === 'x-default') return 'x-default';
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

/** @param {number} position @param {string} message @returns {never} */
function fail(position, message) {
  throw new Error(`${message} (offset ${position})`);
}
