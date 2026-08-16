// @ts-check
import { immutableJsonValue } from './json-value.js';

/**
 * @typedef {object} MarkdownRendererEntry
 * @property {string} name
 * @property {string} [module]
 * @property {import('../index.js').JsonValue} [options]
 * @property {(input: Readonly<MarkdownRendererInput>) => unknown | Promise<unknown>} render
 */

/**
 * @typedef {object} MarkdownRendererInput
 * @property {string} pathname
 * @property {string} html
 * @property {string} [canonicalUrl]
 * @property {string} [routePattern]
 * @property {'prerendered'|'on-demand'} rendering
 * @property {{ kind: string; path?: string; body?: string; hash?: string }} [source]
 * @property {import('../index.js').ExtractionOptions} extraction
 * @property {import('../index.js').JsonValue} [options]
 */

/**
 * @typedef {object} RendererResolution
 * @property {'rendered'|'fallback'} status
 * @property {string} [markdown]
 * @property {string} [renderer]
 * @property {import('../index.js').ExtractionDiagnostics} [extraction]
 * @property {import('../index.js').Diagnostic[]} diagnostics
 */

const RESULT_STATUSES = new Set([
  'rendered',
  'decline',
  'continue',
  'fallback-to-html',
]);

/**
 * Run renderers serially. A failure in extension code is deliberately a
 * representation failure, not a project-HTML failure: diagnose it and retain
 * the rendered-HTML extraction path.
 *
 * @param {MarkdownRendererEntry[]} renderers
 * @param {Omit<MarkdownRendererInput, 'options'>} input
 * @returns {Promise<RendererResolution>}
 */
export async function resolveMarkdownWithRenderers(renderers, input) {
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];

  for (const renderer of renderers) {
    const frozenInput = Object.freeze({
      ...input,
      ...(renderer.options === undefined ? {} : { options: renderer.options }),
      ...(input.source ? { source: freezeSource(input.source) } : {}),
      extraction: /** @type {import('../index.js').ExtractionOptions} */ (
        immutableJsonValue(input.extraction, `${renderer.name} extraction options`)
      ),
    });

    let result;
    try {
      result = await renderer.render(frozenInput);
    } catch {
      diagnostics.push(rendererFailure(
        renderer,
        input.pathname,
        'markdown-renderer-threw',
        `Markdown renderer "${renderer.name}" failed and rendered HTML extraction was retained.`,
      ));
      continue;
    }

    if (!isPlainObject(result) || !RESULT_STATUSES.has(result.status)) {
      diagnostics.push(rendererFailure(
        renderer,
        input.pathname,
        'markdown-renderer-invalid-result',
        `Markdown renderer "${renderer.name}" returned an invalid result and rendered HTML extraction was retained.`,
      ));
      continue;
    }

    const resultDiagnostics = normalizeDiagnostics(result.diagnostics, renderer, input.pathname);
    diagnostics.push(...resultDiagnostics.diagnostics);
    if (resultDiagnostics.invalid) {
      diagnostics.push(rendererFailure(
        renderer,
        input.pathname,
        'markdown-renderer-invalid-diagnostics',
        `Markdown renderer "${renderer.name}" returned invalid diagnostics; those diagnostics were ignored.`,
      ));
    }

    if (result.status === 'decline') {
      if (result.diagnostics !== undefined || Object.keys(result).some((key) => key !== 'status')) {
        diagnostics.push(rendererFailure(
          renderer,
          input.pathname,
          'markdown-renderer-invalid-result',
          `Markdown renderer "${renderer.name}" returned an invalid decline result and rendered HTML extraction was retained.`,
        ));
      }
      continue;
    }

    if (result.status === 'continue') {
      if (resultDiagnostics.diagnostics.length === 0) {
        diagnostics.push(rendererFailure(
          renderer,
          input.pathname,
          'markdown-renderer-invalid-result',
          `Markdown renderer "${renderer.name}" continued without a diagnostic; rendered HTML extraction was retained.`,
        ));
      }
      continue;
    }

    if (result.status === 'fallback-to-html') {
      return { status: 'fallback', diagnostics };
    }

    if (typeof result.markdown !== 'string') {
      diagnostics.push(rendererFailure(
        renderer,
        input.pathname,
        'markdown-renderer-invalid-result',
        `Markdown renderer "${renderer.name}" returned a non-string Markdown value and rendered HTML extraction was retained.`,
      ));
      continue;
    }

    return {
      status: 'rendered',
      markdown: result.markdown,
      renderer: renderer.name,
      extraction: rendererExtraction(renderer.name, input, result.markdown),
      diagnostics,
    };
  }

  return { status: 'fallback', diagnostics };
}

/**
 * Validate the public default export without retaining the module namespace.
 * @param {unknown} value
 * @param {string} source
 * @returns {{ name: string; render: MarkdownRendererEntry['render'] }}
 */
export function validateMarkdownRendererModule(value, source) {
  if (!isPlainObject(value)) {
    throw new TypeError(`Markdown renderer "${source}" must default-export an object.`);
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    throw new TypeError(`Markdown renderer "${source}" must have a non-empty name.`);
  }
  if (value.apiVersion !== 1) {
    throw new TypeError(`Markdown renderer "${source}" must declare apiVersion: 1.`);
  }
  if (typeof value.render !== 'function') {
    throw new TypeError(`Markdown renderer "${source}" must provide render().`);
  }
  return { name: value.name.trim(), render: value.render };
}

/**
 * Clone and freeze renderer options independently of the configuration tree.
 * @param {unknown} value
 * @param {string} label
 * @returns {import('../index.js').JsonValue | undefined}
 */
export function rendererOptions(value, label) {
  return value === undefined ? undefined : immutableJsonValue(value, label);
}

/**
 * @param {unknown} diagnostics
 * @param {MarkdownRendererEntry} renderer
 * @param {string} pathname
 */
function normalizeDiagnostics(diagnostics, renderer, pathname) {
  if (diagnostics === undefined) return { diagnostics: [], invalid: false };
  if (!Array.isArray(diagnostics)) return { diagnostics: [], invalid: true };
  /** @type {import('../index.js').Diagnostic[]} */
  const normalized = [];
  let invalid = false;
  for (const value of diagnostics) {
    if (
      !isPlainObject(value) ||
      typeof value.code !== 'string' ||
      !value.code ||
      typeof value.message !== 'string' ||
      !value.message ||
      !['info', 'warning', 'error'].includes(value.severity ?? 'warning')
    ) {
      invalid = true;
      continue;
    }
    let details;
    try {
      details = value.details === undefined
        ? undefined
        : rendererOptions(value.details, `${renderer.name} diagnostic details`);
    } catch {
      invalid = true;
      continue;
    }
    normalized.push({
      version: 1,
      code: value.code,
      severity: value.severity ?? 'warning',
      message: value.message,
      pathname,
      ...(renderer.module ? { sourcePath: renderer.module } : {}),
      ...(details === undefined ? {} : { details }),
    });
  }
  return { diagnostics: normalized, invalid };
}

/** @param {string} name @param {Omit<MarkdownRendererInput, 'options'>} input @param {string} markdown */
function rendererExtraction(name, input, markdown) {
  return {
    strategy: `renderer:${name}`,
    selectedNodes: 0,
    inputCharacters: input.source?.body?.length ?? input.html.length,
    outputCharacters: markdown.length,
    removedNodes: 0,
  };
}

/**
 * @param {MarkdownRendererEntry} renderer
 * @param {string} pathname
 * @param {string} code
 * @param {string} message
 * @returns {import('../index.js').Diagnostic}
 */
function rendererFailure(renderer, pathname, code, message) {
  return {
    version: 1,
    code,
    severity: 'warning',
    message,
    pathname,
    ...(renderer.module ? { sourcePath: renderer.module } : {}),
  };
}

/** @param {{ kind: string; path?: string; body?: string; hash?: string }} source */
function freezeSource(source) {
  return Object.freeze({ ...source });
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
