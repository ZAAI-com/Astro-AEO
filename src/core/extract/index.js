// @ts-check
import { AeoConfigError } from '../../lib/errors.js';

export const NEVER_CONTENT = ['script', 'style', 'noscript', 'iframe', 'head', 'meta', 'base', 'link'];

const KEEP_ATTRIBUTE = 'data-astro-aeo-keep';
/** Marker value for HTML kept by the converter itself rather than by `keepSelectors`. */
const KEEP_MINIMIZED = 'minimized';

/**
 * Interface chrome with no reading value: copy buttons (disclosure toggles
 * stay, since their label is often an FAQ question), icons, decorative
 * elements hidden from assistive technology, and inert templates.
 */
const CHROME_SELECTOR = 'button:not([aria-expanded]):not([aria-controls]), svg, template, [hidden], [aria-hidden="true"]';

/**
 * Attributes a raw HTML block may keep. Everything else (classes, ids,
 * `data-*`, framework scoping attributes) is presentation and is dropped.
 */
const RAW_HTML_ATTRIBUTES = new Set([
  'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'headers', 'datetime', 'lang',
  'aria-label', 'poster', 'type',
]);

/** Cell content a GFM pipe table cannot represent on one line. */
const TABLE_BLOCK_CONTENT = 'p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6, hr, dl, figure';

/**
 * @typedef {object} ExtractionOptions
 * @property {string[]} selectors        Tried in order; the first with matches wins.
 * @property {string[]} removeSelectors  Dropped before conversion.
 * @property {string[]} keepSelectors    Preserved as raw HTML in the Markdown.
 */

const URL_ATTRIBUTES = [
  ['a[href]', 'href'],
  ['area[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
  ['video[poster]', 'poster'],
  ['object[data]', 'data'],
];
const ACTIVE_URL_ATTRIBUTES = ['href', 'src', 'data', 'poster', 'action', 'formaction', 'xlink:href'];

/**
 * @typedef {object} ExtractionDiagnostics
 * @property {string} strategy           The winning selector, or the fallback used.
 * @property {number} selectedNodes      Top-level matches converted.
 * @property {number} removedNodes       Elements dropped before conversion.
 * @property {number} [keptHtmlBlocks]   Blocks emitted as raw HTML rather than Markdown.
 * @property {number} inputCharacters
 * @property {number} outputCharacters
 * @property {string} [fallbackReason]
 */

/**
 * @param {Document} probe
 * @param {string} path
 * @param {string[]} selectors
 * @returns {void}
 */
export function assertValidSelectors(probe, path, selectors) {
  for (const selector of selectors) {
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new AeoConfigError(
        `astro-aeo: ${path} contains an empty selector. Remove it, or replace it with a CSS selector.`,
      );
    }
    try {
      probe.querySelector(selector);
    } catch {
      throw new AeoConfigError(
        `astro-aeo: ${path} contains an invalid CSS selector: ${JSON.stringify(selector)}.`,
      );
    }
  }
}

/**
 * @param {Document} probe
 * @param {string} path
 * @param {Partial<ExtractionOptions> | undefined} extraction
 */
export function assertValidExtractionOptions(probe, path, extraction) {
  if (!extraction) return;
  for (const key of /** @type {const} */ (['selectors', 'removeSelectors', 'keepSelectors'])) {
    const value = extraction[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw new AeoConfigError(`astro-aeo: ${path}.${key} must be an array of CSS selectors.`);
    }
    if (value.length > 0) assertValidSelectors(probe, `${path}.${key}`, value);
  }
}

/**
 * @param {Document} document
 * @param {string[]} selectors
 * @param {string[]} [removeSelectors]
 * @returns {{ roots: Element[]; strategy: string; fallbackReason: string | undefined }}
 */
export function selectContentRoots(document, selectors, removeSelectors = []) {
  const forbidden = [...NEVER_CONTENT, ...removeSelectors].join(',');
  for (const selector of selectors) {
    const matches = [...document.querySelectorAll(selector)].filter(
      (element) => !element.matches(forbidden) && !element.closest(forbidden),
    );
    if (matches.length === 0) continue;
    const topLevel = matches.filter((el) => !matches.some((other) => other !== el && other.contains(el)));
    return { roots: topLevel, strategy: selector, fallbackReason: undefined };
  }

  const reason = selectors.length
    ? `no element matched ${selectors.map((s) => JSON.stringify(s)).join(', ')}`
    : 'no selectors configured';

  if (
    document.body &&
    document.body.childNodes.length > 0 &&
    !document.body.closest(forbidden)
  ) {
    return { roots: [document.body], strategy: 'body', fallbackReason: reason };
  }
  const root = document.documentElement ?? /** @type {any} */ (document);
  return {
    roots: [root],
    strategy: 'document',
    fallbackReason: `${reason}, and no populated <body> element`,
  };
}

/**
 * Return matching descendants and the root itself when it matches. Native
 * `querySelectorAll()` deliberately excludes the root, which otherwise makes
 * selected links, images, and preserved roots behave differently from children.
 *
 * @param {Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function matchingElements(root, selector) {
  return [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
}

/**
 * @param {Element} root
 * @param {{ removeSelectors: string[]; keepSelectors: string[] }} options
 * @returns {number} elements removed
 */
export function cleanRoot(root, { removeSelectors, keepSelectors }) {
  let removed = 0;
  for (const selector of [...NEVER_CONTENT, ...removeSelectors]) {
    if (root.matches(selector)) {
      root.replaceChildren();
      return removed + 1;
    }
    for (const el of matchingElements(root, selector)) {
      if (el === root) continue;
      el.remove();
      removed++;
    }
  }
  for (const selector of keepSelectors) {
    for (const el of matchingElements(root, selector)) el.setAttribute(KEEP_ATTRIBUTE, '');
  }
  removed += removeChrome(root);
  sanitizeRoot(root);
  normalizeFigures(root);
  normalizeDefinitionLists(root);
  const unmarked = (/** @type {Element} */ el) => !el.hasAttribute(KEEP_ATTRIBUTE);
  // Markdown has no syntax for audio or video, so their sources survive as HTML.
  markTopLevelRawHtml(root, 'table, video, audio', (el) =>
    unmarked(el) && (el.localName !== 'table' || !isSimpleTable(el)));
  return removed;
}

/** @param {Element} root @returns {number} */
function removeChrome(root) {
  let removed = 0;
  for (const el of matchingElements(root, CHROME_SELECTOR)) {
    if (el === root || !el.isConnected) continue;
    // A hidden wrapper around a described image still carries content.
    if (el.localName !== 'svg' && hasDescribedImage(el)) continue;
    el.remove();
    removed++;
  }
  return removed;
}

/** @param {Element} el @returns {boolean} */
function hasDescribedImage(el) {
  return matchingElements(el, 'img').some((image) => (image.getAttribute('alt') ?? '').trim());
}

/**
 * Rewrite figures into ordinary blocks so images become `![alt](src)` and the
 * caption becomes an emphasized line, instead of a raw HTML dump.
 *
 * @param {Element} root
 */
function normalizeFigures(root) {
  const document = root.ownerDocument;
  for (const figure of matchingElements(root, 'figure').reverse()) {
    for (const caption of [...figure.querySelectorAll('figcaption')]) {
      if (caption.closest('figure') !== figure) continue;
      const paragraph = document.createElement('p');
      const emphasis = document.createElement('em');
      emphasis.innerHTML = caption.innerHTML;
      paragraph.appendChild(emphasis);
      if ((caption.textContent ?? '').trim()) caption.replaceWith(paragraph);
      else caption.remove();
    }
    if (figure === root) continue;
    replaceTag(figure, 'div');
  }
}

/**
 * Rewrite definition lists into a bold term followed by its description.
 *
 * @param {Element} root
 */
function normalizeDefinitionLists(root) {
  const document = root.ownerDocument;
  for (const list of matchingElements(root, 'dl').reverse()) {
    for (const term of [...list.querySelectorAll('dt')]) {
      if (term.closest('dl') !== list) continue;
      const paragraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.innerHTML = term.innerHTML;
      paragraph.appendChild(strong);
      term.replaceWith(paragraph);
    }
    for (const description of [...list.querySelectorAll('dd')]) {
      if (description.closest('dl') !== list) continue;
      replaceTag(description, 'div');
    }
    if (list !== root) replaceTag(list, 'div');
  }
}

/**
 * @param {Element} el
 * @param {string} tag
 */
function replaceTag(el, tag) {
  const replacement = el.ownerDocument.createElement(tag);
  for (const attribute of [...el.attributes]) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  while (el.firstChild) replacement.appendChild(el.firstChild);
  el.replaceWith(replacement);
}

/**
 * A table converts to a GFM pipe table when every cell is a single span and
 * holds inline content only.
 *
 * @param {Element} table
 * @returns {boolean}
 */
export function isSimpleTable(table) {
  const rows = tableRows(table);
  if (rows.length === 0) return false;
  for (const row of rows) {
    for (const cell of tableCells(row)) {
      if (Number(cell.getAttribute('colspan') ?? 1) > 1) return false;
      if (Number(cell.getAttribute('rowspan') ?? 1) > 1) return false;
      if (cell.querySelector(TABLE_BLOCK_CONTENT)) return false;
    }
  }
  return true;
}

/** @param {Element} table @returns {Element[]} */
function tableRows(table) {
  return [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table);
}

/** @param {Element} row @returns {Element[]} */
function tableCells(row) {
  return [...row.children].filter((cell) => cell.localName === 'td' || cell.localName === 'th');
}

/**
 * Remove presentational attributes and unwrap attribute-less wrappers so a
 * raw HTML block stays small and stable across styling changes.
 *
 * @param {Element} root
 */
function minimizeRawHtml(root) {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (!RAW_HTML_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const columns of [...root.querySelectorAll('colgroup, col')]) columns.remove();
  for (const wrapper of [...root.querySelectorAll('div, span')].reverse()) {
    if (wrapper.attributes.length > 0) continue;
    wrapper.replaceWith(...wrapper.childNodes);
  }
}

/** @param {Element} root @returns {number} */
export function sanitizeRoot(root) {
  let removed = 0;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'srcdoc' ||
        name === 'srcset' ||
        name === 'ping' ||
        (ACTIVE_URL_ATTRIBUTES.includes(name) && unsafeProtocol(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
        removed++;
      }
    }
  }
  return removed;
}

/** @param {string} value @returns {boolean} */
function unsafeProtocol(value) {
  const compact = value.trim().replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
  const match = compact.match(/^([a-z][a-z0-9+.-]*):/);
  return Boolean(match && !['http', 'https', 'mailto', 'tel'].includes(match[1]));
}

/**
 * @param {Element} root
 * @param {string} selector
 * @param {(element: Element) => boolean} predicate
 */
function markTopLevelRawHtml(root, selector, predicate) {
  const matches = matchingElements(root, selector).filter(predicate);
  for (const element of matches) {
    if (matches.some((other) => other !== element && other.contains(element))) continue;
    element.setAttribute(KEEP_ATTRIBUTE, KEEP_MINIMIZED);
  }
}

/**
 * @param {import('turndown')} td
 * @returns {import('turndown')}
 */
export function addKeepRule(td) {
  td.addRule('astroAeoKeep', {
    filter: (node) => Boolean(node.getAttribute && node.getAttribute(KEEP_ATTRIBUTE) !== null),
    replacement: (_content, node) => {
      const el = /** @type {any} */ (node);
      const minimize = el.getAttribute(KEEP_ATTRIBUTE) === KEEP_MINIMIZED;
      el.removeAttribute(KEEP_ATTRIBUTE);
      for (const nested of el.querySelectorAll?.(`[${KEEP_ATTRIBUTE}]`) ?? []) {
        nested.removeAttribute(KEEP_ATTRIBUTE);
      }
      if (minimize) minimizeRawHtml(el);
      return `\n\n${el.outerHTML}\n\n`;
    },
  });
  td.addRule('astroAeoTable', {
    filter: (node) => node.nodeName === 'TABLE' && node.getAttribute(KEEP_ATTRIBUTE) === null,
    replacement: (_content, node) => `\n\n${pipeTable(td, /** @type {any} */ (node))}\n\n`,
  });
  return td;
}

/**
 * @param {import('turndown')} td
 * @param {Element} table
 * @returns {string}
 */
function pipeTable(td, table) {
  const cell = (/** @type {Element} */ el) =>
    td
      .turndown(el.innerHTML)
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\|/g, '\\|')
      .trim();
  const rows = tableRows(table).map((row) => tableCells(row).map(cell));
  const width = Math.max(...rows.map((row) => row.length));
  if (width === 0) return '';
  const line = (/** @type {string[]} */ row) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  const [header, ...body] = rows;
  const caption = table.querySelector('caption');
  const captionText = caption && caption.closest('table') === table ? cell(caption) : '';
  return [
    ...(captionText ? [`_${captionText}_`, ''] : []),
    line(header),
    line(Array.from({ length: width }, () => '---')),
    ...body.map(line),
  ].join('\n');
}

/**
 * @param {Element} root
 * @param {string} baseUrl
 * @returns {number} attributes rewritten
 */
export function resolveUrls(root, baseUrl) {
  let rewritten = 0;
  for (const [selector, attribute] of URL_ATTRIBUTES) {
    for (const el of matchingElements(root, selector)) {
      const value = el.getAttribute(attribute);
      if (!value || value.startsWith('#')) continue;
      try {
        const resolved = new URL(value, baseUrl);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
        if (resolved.href === value) continue;
        el.setAttribute(attribute, resolved.href);
        rewritten++;
      } catch {}
    }
  }
  return rewritten;
}

/**
 * @param {Element} root
 * @returns {number} elements enriched
 */
export function enrichAccessibleNames(root) {
  let enriched = 0;

  for (const image of matchingElements(root, 'img')) {
    if ((image.getAttribute('alt') ?? '').trim()) continue;
    const name = accessibleName(image);
    if (!name) continue;
    image.setAttribute('alt', name);
    enriched++;
  }

  for (const link of matchingElements(root, 'a[href]')) {
    if ((link.textContent ?? '').trim()) continue;
    if ([...link.querySelectorAll('img')].some((image) => (image.getAttribute('alt') ?? '').trim())) {
      continue;
    }
    const name = accessibleName(link);
    if (!name) continue;
    link.textContent = name;
    enriched++;
  }

  return enriched;
}

/** @param {Element} element @returns {string} */
function accessibleName(element) {
  if (element.localName === 'img') {
    const alt = (element.getAttribute('alt') ?? '').trim();
    if (alt) return alt;
  }
  const ariaLabel = (element.getAttribute('aria-label') ?? '').trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = (element.getAttribute('aria-labelledby') ?? '').trim();
  if (labelledBy) {
    const document = element.ownerDocument;
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document?.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (label) return label;
  }

  return (element.getAttribute('title') ?? '').trim();
}

/**
 * @param {Document} document
 * @param {ExtractionOptions} options
 * @param {import('turndown')} td
 * @param {{ baseUrl?: string }} [context]  `baseUrl` absolutizes relative links.
 * @returns {{ markdown: string; diagnostics: ExtractionDiagnostics }}
 */
export function extractMarkdown(document, options, td, context = {}) {
  const inputCharacters = document.documentElement?.outerHTML?.length ?? 0;
  const { roots, strategy, fallbackReason } = selectContentRoots(
    document,
    options.selectors,
    options.removeSelectors,
  );

  let removedNodes = 0;
  let keptHtmlBlocks = 0;
  const parts = roots.map((root) => {
    removedNodes += cleanRoot(root, options);
    enrichAccessibleNames(root);
    if (context.baseUrl) resolveUrls(root, context.baseUrl);
    keptHtmlBlocks += matchingElements(root, `[${KEEP_ATTRIBUTE}]`).filter(
      (el) => el === root || !el.parentElement?.closest(`[${KEEP_ATTRIBUTE}]`),
    ).length;
    if (root.getAttribute(KEEP_ATTRIBUTE) !== null) {
      const minimize = root.getAttribute(KEEP_ATTRIBUTE) === KEEP_MINIMIZED;
      root.removeAttribute(KEEP_ATTRIBUTE);
      for (const nested of root.querySelectorAll(`[${KEEP_ATTRIBUTE}]`)) {
        nested.removeAttribute(KEEP_ATTRIBUTE);
      }
      if (minimize) minimizeRawHtml(root);
      return root.outerHTML;
    }
    // Turndown accepts an Element but converts only its children. Supplying the
    // serialized root preserves selected links, images, and other semantic
    // elements that are themselves the extraction root.
    return td.turndown(root.outerHTML).trim();
  });

  const markdown = parts.filter(Boolean).join('\n\n');
  return {
    markdown,
    diagnostics: {
      strategy,
      selectedNodes: roots.length,
      removedNodes,
      keptHtmlBlocks,
      inputCharacters,
      outputCharacters: markdown.length,
      fallbackReason,
    },
  };
}
