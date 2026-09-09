// @ts-check
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} AeoDiagnosticManifestV1
 * @property {1} version
 * @property {string} generatedAt
 * @property {{ pathname: string; source?: string; sourcePath?: string; extraction?: import('../index.js').ExtractionDiagnostics; diagnostics: import('../index.js').Diagnostic[] }[]} pages
 * @property {import('../index.js').Diagnostic[]} diagnostics
 */

/**
 * Persist build diagnostics privately. Only selected metadata is copied from a
 * page record: source and rendered content must never enter this manifest.
 *
 * @param {string} projectRoot
 * @param {import('../core/page-model.js').BuildPage[]} pages
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @param {Date} [now]
 * @returns {string} final manifest path
 */
export function writeDiagnosticsManifest(projectRoot, pages, diagnostics = [], now = new Date()) {
  const directory = join(projectRoot, '.astro', 'aeo-cache');
  const output = diagnosticsManifestPath(projectRoot);
  const temporary = join(directory, `.diagnostics-v1.${process.pid}.tmp`);
  mkdirSync(directory, { recursive: true });

  const contents = serializeDiagnosticsManifest(pages, diagnostics, now);

  writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, output);
  return output;
}

/** @param {string} projectRoot */
export function diagnosticsManifestPath(projectRoot) {
  return join(projectRoot, '.astro', 'aeo-cache', 'diagnostics-v1.json');
}

/**
 * @param {import('../core/page-model.js').BuildPage[]} pages
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @param {Date} [now]
 */
export function serializeDiagnosticsManifest(pages, diagnostics = [], now = new Date()) {
  /** @type {AeoDiagnosticManifestV1} */
  const manifest = {
    version: 1,
    generatedAt: now.toISOString(),
    pages: pages.map((page) => ({
      pathname: page.pathname,
      ...(page.source ? { source: sourceStrategy(page.source) } : {}),
      ...(sourcePath(page.source) ? { sourcePath: sourcePath(page.source) } : {}),
      ...(page.extraction ? { extraction: page.extraction } : {}),
      diagnostics: sanitizeDiagnostics(page.diagnostics),
    })),
    diagnostics: sanitizeDiagnostics(diagnostics),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** @param {unknown} diagnostics @returns {import('../index.js').Diagnostic[]} */
function sanitizeDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const diagnostic = /** @type {any} */ (value);
    if (
      diagnostic.version !== 1 ||
      typeof diagnostic.code !== 'string' ||
      !['info', 'warning', 'error'].includes(diagnostic.severity) ||
      typeof diagnostic.message !== 'string'
    ) {
      return [];
    }
    return [{
      version: 1,
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(typeof diagnostic.pathname === 'string' ? { pathname: diagnostic.pathname } : {}),
      ...(typeof diagnostic.sourcePath === 'string' ? { sourcePath: diagnostic.sourcePath } : {}),
    }];
  });
}

/** @param {unknown} source @returns {string} */
function sourceStrategy(source) {
  if (typeof source === 'string') return source;
  return typeof /** @type {any} */ (source)?.strategy === 'string'
    ? /** @type {any} */ (source).strategy
    : 'rendered';
}

/** @param {unknown} source @returns {string | undefined} */
function sourcePath(source) {
  return typeof /** @type {any} */ (source)?.path === 'string'
    ? /** @type {any} */ (source).path
    : undefined;
}
