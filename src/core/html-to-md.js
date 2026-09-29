// @ts-check
import { DOMParser as LinkedomDOMParser } from 'linkedom/worker';
import { parseDocument } from './html-document.js';
import { addKeepRule, extractMarkdown, NEVER_CONTENT } from './extract/index.js';

/** @typedef {typeof import('turndown')} TurndownConstructor */
/** @typedef {() => Promise<{ default: TurndownConstructor } | TurndownConstructor>} TurndownImporter */

/**
 * @param {TurndownImporter} [importTurndown]
 * @returns {() => Promise<TurndownConstructor>}
 */
export function createTurndownLoader(importTurndown = () => import('turndown')) {
  /** @type {Promise<TurndownConstructor> | undefined} */
  let cached;

  return function load() {
    if (cached) return cached;

    const pending = importWithDomParser(importTurndown);
    const guarded = pending.catch((error) => {
      if (cached === guarded) cached = undefined;
      throw error;
    });
    cached = guarded;
    return guarded;
  };
}

const loadTurndown = createTurndownLoader();

/**
 * @param {TurndownImporter} importTurndown
 * @returns {Promise<TurndownConstructor>}
 */
async function importWithDomParser(importTurndown) {
  const root = /** @type {typeof globalThis & { window?: any }} */ (globalThis);
  const hadGlobalParser = Object.prototype.hasOwnProperty.call(root, 'DOMParser');
  const previousGlobalParser = root.DOMParser;
  const hadWindow = Object.prototype.hasOwnProperty.call(root, 'window');
  const previousWindow = root.window;
  const previousWindowObject = isObject(root.window) ? root.window : undefined;
  const hadWindowParser = previousWindowObject
    ? Object.prototype.hasOwnProperty.call(previousWindowObject, 'DOMParser')
    : false;
  const previousWindowParser = previousWindowObject?.DOMParser;
  let installedGlobalParser = false;
  let installedWindow = false;
  let installedWindowParser = false;

  if (typeof root.DOMParser === 'undefined') {
    root.DOMParser = /** @type {any} */ (LinkedomDOMParser);
    installedGlobalParser = true;
  }

  if (!isObject(root.window)) {
    root.window = root;
    installedWindow = true;
  } else if (typeof root.window.DOMParser === 'undefined') {
    root.window.DOMParser = root.DOMParser;
    installedWindowParser = true;
  }

  try {
    const imported = await importTurndown();
    return /** @type {TurndownConstructor} */ (
      typeof imported === 'function' ? imported : imported.default
    );
  } finally {
    if (installedWindowParser && root.window === previousWindow) {
      restoreOwnProperty(root.window, 'DOMParser', hadWindowParser, previousWindowParser);
    }
    if (installedWindow && root.window === root) {
      restoreOwnProperty(root, 'window', hadWindow, previousWindow);
    }
    if (installedGlobalParser && root.DOMParser === LinkedomDOMParser) {
      restoreOwnProperty(root, 'DOMParser', hadGlobalParser, previousGlobalParser);
    }
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * @param {Record<string, any>} target
 * @param {string} key
 * @param {boolean} hadOwn
 * @param {any} previous
 */
function restoreOwnProperty(target, key, hadOwn, previous) {
  if (hadOwn) target[key] = previous;
  else Reflect.deleteProperty(target, key);
}

/**
 * Wraps rendered content in an emphasis delimiter. Emphasis must open and
 * close on one line, next to text, but block children leave blank lines
 * inside the delimiters, which ends the paragraph and strands a literal `**`.
 * Content without a line break takes Turndown's own output unchanged.
 * Otherwise edge line breaks move outside the delimiters and inner blank-line
 * runs become one space, while a `<br>` between words (`A  \nB`) stays a
 * valid hard break. Code inside emphasis would lose its blank lines too, but
 * that markup does not occur in practice.
 *
 * @param {string} delimiter
 * @param {string} content
 * @returns {string}
 */
function wrapInline(delimiter, content) {
  if (!content.includes('\n')) return content.trim() ? delimiter + content + delimiter : '';
  const body = content.trim();
  if (!body) return '';
  const lead = content.slice(0, content.length - content.trimStart().length);
  const trail = content.slice(content.trimEnd().length);
  /** @param {string} ws */
  const outside = (ws) => (ws.includes('\n') ? ws : '');
  /** @param {string} ws */
  const inside = (ws) => (ws.includes('\n') ? '' : ws);
  return outside(lead) + delimiter + inside(lead) + body.replace(/[ \t]*\n(?:[ \t]*\n)+[ \t]*/g, ' ')
    + inside(trail) + delimiter + outside(trail);
}

/** @returns {Promise<import('turndown')>} */
export async function createTurndown() {
  const TurndownService = await loadTurndown();
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  td.remove(/** @type {any} */ (NEVER_CONTENT));
  // Registered before addKeepRule(), so kept elements and tables still win.
  td.addRule('astroAeoStrong', {
    filter: ['strong', 'b'],
    replacement: (content, _node, options) => wrapInline(options.strongDelimiter ?? '**', content),
  });
  td.addRule('astroAeoEmphasis', {
    filter: ['em', 'i'],
    replacement: (content, _node, options) => wrapInline(options.emDelimiter ?? '_', content),
  });

  return addKeepRule(td);
}

/**
 * @param {string} html
 * @param {import('../core/extract/index.js').ExtractionOptions} extraction
 * @param {import('turndown')} [td]
 * @param {{ baseUrl?: string }} [context]
 * @returns {Promise<{ markdown: string; diagnostics: import('../core/extract/index.js').ExtractionDiagnostics }>}
 */
export async function htmlToMarkdownWithDiagnostics(html, extraction, td, context = {}) {
  return extractMarkdown(parseDocument(html), extraction, td ?? (await createTurndown()), context);
}

/**
 * @param {string} html
 * @param {import('turndown')} [td]
 * @returns {Promise<string>}
 */
export async function htmlToMarkdown(html, td) {
  return (await htmlToMarkdownWithDiagnostics(html, DEFAULT_EXTRACTION, td)).markdown;
}

/** @type {import('../core/extract/index.js').ExtractionOptions} */
export const DEFAULT_EXTRACTION = {
  selectors: ['article', 'main'],
  removeSelectors: ['nav', 'footer'],
  keepSelectors: [],
};
