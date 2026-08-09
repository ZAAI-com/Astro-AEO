// @ts-check
import { AeoConfigError } from '../../lib/errors.js';

export const NEVER_CONTENT = ['script', 'style', 'noscript', 'iframe', 'head', 'meta', 'base', 'link'];

const KEEP_ATTRIBUTE = 'data-astro-aeo-keep';

const SEMANTIC_HTML_SELECTOR = 'figure, dl, table, time, address, cite';

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
  sanitizeRoot(root);
  markTopLevelRawHtml(root, SEMANTIC_HTML_SELECTOR);
  return removed;
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
 */
function markTopLevelRawHtml(root, selector) {
  const matches = matchingElements(root, selector);
  for (const element of matches) {
    if (matches.some((other) => other !== element && other.contains(element))) continue;
    element.setAttribute(KEEP_ATTRIBUTE, '');
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
      el.removeAttribute(KEEP_ATTRIBUTE);
      for (const nested of el.querySelectorAll?.(`[${KEEP_ATTRIBUTE}]`) ?? []) {
        nested.removeAttribute(KEEP_ATTRIBUTE);
      }
      return `\n\n${el.outerHTML}\n\n`;
    },
  });
  return td;
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
  const parts = roots.map((root) => {
    removedNodes += cleanRoot(root, options);
    enrichAccessibleNames(root);
    if (context.baseUrl) resolveUrls(root, context.baseUrl);
    if (root.getAttribute(KEEP_ATTRIBUTE) !== null) {
      root.removeAttribute(KEEP_ATTRIBUTE);
      for (const nested of root.querySelectorAll(`[${KEEP_ATTRIBUTE}]`)) {
        nested.removeAttribute(KEEP_ATTRIBUTE);
      }
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
      inputCharacters,
      outputCharacters: markdown.length,
      fallbackReason,
    },
  };
}
