// @ts-check
import { AeoConfigError } from '../../lib/errors.js';

/**
 * Content extraction: pick the part of a rendered page that is the page, and drop
 * the chrome around it.
 *
 * Everything here takes a parsed `Document` and never parses one itself, so the
 * same functions run over build output, a dev self-fetch, and a request-time
 * response without knowing the difference.
 */

/**
 * Nodes that are never page content and can never be restored by `keepSelectors`.
 * `head` is here so the document-level fallback below cannot leak `<title>` and
 * `<meta>` text into the Markdown.
 */
export const NEVER_CONTENT = ['script', 'style', 'noscript', 'iframe', 'head'];

/** Marks an element that `keepSelectors` should emit as raw HTML. */
const KEEP_ATTRIBUTE = 'data-astro-aeo-keep';

/**
 * @typedef {object} ExtractionOptions
 * @property {string[]} selectors        Tried in order; the first with matches wins.
 * @property {string[]} removeSelectors  Dropped before conversion.
 * @property {string[]} keepSelectors    Preserved as raw HTML in the Markdown.
 */

/** Attributes carrying a URL that should survive being read away from the site. */
const URL_ATTRIBUTES = [
  ['a[href]', 'href'],
  ['area[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
  ['video[poster]', 'poster'],
];

/**
 * @typedef {object} ExtractionDiagnostics
 * @property {string} strategy           The winning selector, or the fallback used.
 * @property {number} selectedNodes      Top-level matches converted.
 * @property {number} removedNodes       Elements dropped before conversion.
 * @property {number} inputCharacters
 * @property {number} outputCharacters
 * @property {string | undefined} fallbackReason
 */

/**
 * Validate configured selectors once, at config time, so a typo is a
 * configuration error rather than a silent no-op on every page.
 * @param {Document} probe   Any parsed document; only used to run the selector.
 * @param {string} path      Dotted config path, for the message.
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
 * Choose the elements to convert.
 *
 * Selectors are tried in order and the first one with any match wins, so
 * `['article', 'main']` prefers a semantic article and falls back to the main
 * region. Only top-level matches are kept: an `<article>` nested inside another
 * `<article>` would otherwise have its content emitted twice.
 *
 * @param {Document} document
 * @param {string[]} selectors
 * @returns {{ roots: Element[]; strategy: string; fallbackReason: string | undefined }}
 */
export function selectContentRoots(document, selectors) {
  for (const selector of selectors) {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length === 0) continue;
    const topLevel = matches.filter((el) => !matches.some((other) => other !== el && other.contains(el)));
    return { roots: topLevel, strategy: selector, fallbackReason: undefined };
  }

  const reason = selectors.length
    ? `no element matched ${selectors.map((s) => JSON.stringify(s)).join(', ')}`
    : 'no selectors configured';

  // A parser only synthesizes <html>/<body> for a well-formed document. Given a
  // bare fragment it leaves `body` present but empty, with the real content
  // hanging off documentElement, so an unconditional `document.body` would
  // silently convert nothing.
  if (document.body && document.body.childNodes.length > 0) {
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
 * Drop unwanted nodes, and mark the ones to preserve verbatim.
 *
 * Removal beats preservation: an element matched by both is removed, and the four
 * unsafe tags are removed before `keepSelectors` is even consulted, so no
 * configuration can reintroduce a `<script>` into the Markdown.
 *
 * @param {Element} root
 * @param {{ removeSelectors: string[]; keepSelectors: string[] }} options
 * @returns {number} elements removed
 */
export function cleanRoot(root, { removeSelectors, keepSelectors }) {
  let removed = 0;
  for (const selector of [...NEVER_CONTENT, ...removeSelectors]) {
    for (const el of [...root.querySelectorAll(selector)]) {
      el.remove();
      removed++;
    }
    // querySelectorAll only looks at descendants, so a root that is itself a
    // match would survive. Its children are converted, which is the same result
    // as removing it, so there is nothing to do but count it correctly.
  }
  for (const selector of keepSelectors) {
    for (const el of [...root.querySelectorAll(selector)]) el.setAttribute(KEEP_ATTRIBUTE, '');
  }
  return removed;
}

/**
 * Add the rule that emits `keepSelectors` matches as raw HTML.
 * @param {import('turndown')} td
 * @returns {import('turndown')}
 */
export function addKeepRule(td) {
  td.addRule('astroAeoKeep', {
    filter: (node) => Boolean(node.getAttribute && node.getAttribute(KEEP_ATTRIBUTE) !== null),
    replacement: (_content, node) => {
      const el = /** @type {any} */ (node);
      el.removeAttribute(KEEP_ATTRIBUTE);
      return `\n\n${el.outerHTML}\n\n`;
    },
  });
  return td;
}

/**
 * Rewrite relative URLs to absolute ones.
 *
 * A `.md` companion is read away from the site that served it, so `](/about/)`
 * is a dead link the moment the file is copied into a prompt or an index. The
 * page's own canonical URL is the only correct base.
 *
 * Fragment-only links and non-navigational schemes (`mailto:`, `tel:`, `data:`,
 * and anything else without a host) are left exactly as authored.
 *
 * @param {Element} root
 * @param {string} baseUrl
 * @returns {number} attributes rewritten
 */
export function resolveUrls(root, baseUrl) {
  let rewritten = 0;
  for (const [selector, attribute] of URL_ATTRIBUTES) {
    for (const el of [...root.querySelectorAll(selector)]) {
      const value = el.getAttribute(attribute);
      if (!value || value.startsWith('#')) continue;
      try {
        const resolved = new URL(value, baseUrl);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
        if (resolved.href === value) continue;
        el.setAttribute(attribute, resolved.href);
        rewritten++;
      } catch {
        // Not a resolvable URL. Leave the author's value alone rather than guess.
      }
    }
  }
  return rewritten;
}

/**
 * Extract a page's content as Markdown.
 * @param {Document} document
 * @param {ExtractionOptions} options
 * @param {import('turndown')} td
 * @param {{ baseUrl?: string }} [context]  `baseUrl` absolutizes relative links.
 * @returns {{ markdown: string; diagnostics: ExtractionDiagnostics }}
 */
export function extractMarkdown(document, options, td, context = {}) {
  const inputCharacters = document.documentElement?.outerHTML?.length ?? 0;
  const { roots, strategy, fallbackReason } = selectContentRoots(document, options.selectors);

  let removedNodes = 0;
  const parts = roots.map((root) => {
    removedNodes += cleanRoot(root, options);
    if (context.baseUrl) resolveUrls(root, context.baseUrl);
    // Hand Turndown the element, not `root.innerHTML`. Re-serializing and
    // reparsing is wasted work, and it would route the text through a second DOM
    // implementation (Turndown's own) whose normalization need not match this one.
    return td.turndown(/** @type {any} */ (root)).trim();
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
