// @ts-check
import Defuddle from 'defuddle';
import { createTurndown, htmlToMarkdownWithDiagnostics } from '../core/html-to-md.js';
import { parseDocument } from '../core/html-document.js';

const FORCED_OPTIONS = new Set([
  'debug',
  'fetch',
  'markdown',
  'separateMarkdown',
  'url',
  'useAsync',
]);

export default {
  name: 'astro-aeo/defuddle',
  apiVersion: 1,

  /** @param {any} input */
  async render(input) {
    let configured;
    try {
      configured = defuddleOptions(input.options);
    } catch {
      return {
        status: 'continue',
        diagnostics: [{
          code: 'defuddle-invalid-options',
          severity: 'warning',
          message: 'The Defuddle renderer options are invalid.',
        }],
      };
    }

    try {
      const document = parseDocument(input.html);
      const parserUrl = input.canonicalUrl ?? syntheticUrl(input.pathname);
      const parser = new Defuddle(document, {
        ...configured,
        // Never invoke asynchronous extractors or third-party fallbacks.
        useAsync: false,
        // The shared Turndown configuration remains the one Markdown converter.
        markdown: false,
        separateMarkdown: false,
        debug: false,
        url: parserUrl,
        fetch: noNetworkFetch,
      });
      const result = parser.parse();
      if (result && typeof /** @type {any} */ (result).then === 'function') {
        throw new TypeError('Defuddle unexpectedly returned an asynchronous result');
      }
      if (!result || typeof result.content !== 'string' || result.content === '') {
        return {
          status: 'continue',
          diagnostics: [{
            code: 'defuddle-no-content',
            severity: 'warning',
            message: 'Defuddle found no local content; configured rendered HTML extraction was retained.',
          }],
        };
      }
      const cleanedHtml = input.canonicalUrl
        ? result.content
        : removeSyntheticOrigin(result.content);
      const converted = await htmlToMarkdownWithDiagnostics(
        cleanedHtml,
        input.extraction,
        await createTurndown(),
        { baseUrl: input.canonicalUrl },
      );
      return {
        status: 'rendered',
        markdown: converted.markdown,
      };
    } catch {
      return {
        status: 'continue',
        diagnostics: [{
          code: 'defuddle-failed',
          severity: 'warning',
          message:
            `Defuddle could not clean the already-rendered local HTML; ` +
            'configured extraction was retained.',
        }],
      };
    }
  },
};

/** @param {unknown} value */
function defuddleOptions(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new TypeError('options must be an object');
  for (const key of Object.keys(value)) {
    if (FORCED_OPTIONS.has(key)) {
      throw new TypeError(`option "${key}" is controlled by astro-aeo`);
    }
  }
  return value;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


/** @param {string} pathname */
function syntheticUrl(pathname) {
  try {
    return new URL(pathname, 'https://astro-aeo.invalid/').href;
  } catch {
    return 'https://astro-aeo.invalid/';
  }
}

/** @param {string} html */
function removeSyntheticOrigin(html) {
  return html.replaceAll('https://astro-aeo.invalid/', '/');
}

/** @returns {never} */
function noNetworkFetch() {
  throw new Error('astro-aeo/defuddle does not permit network requests');
}
