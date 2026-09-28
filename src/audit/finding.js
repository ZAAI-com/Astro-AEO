// @ts-check
import { categoryFor, getRule, helpUrlFor } from './rules.js';

/**
 * Adapters from the four pre-1.4 finding shapes to the public `Finding`. Codes
 * pass through verbatim as `ruleId`, and the emitter's severity wins over the
 * registry default.
 *
 * @typedef {import('../index.js').Finding} Finding
 * @typedef {import('../index.js').Diagnostic} Diagnostic
 * @typedef {import('../schema.js').GraphFinding} GraphFinding
 * @typedef {import('../build/sitemap-validate.js').SitemapFinding} SitemapFinding
 * @typedef {import('../../cli/validate.js').LegacyFinding} LegacyFinding
 * @typedef {import('../../cli/validate.js').ValidateResult} ValidateResult
 */

/**
 * @param {{
 *   ruleId: string;
 *   severity: Finding['severity'];
 *   message: string;
 *   file?: string;
 *   url?: string;
 *   location?: Finding['location'];
 *   evidence?: string;
 * }} input
 * @returns {Finding}
 */
export function createFinding(input) {
  return {
    version: 1,
    ruleId: input.ruleId,
    severity: input.severity,
    category: categoryFor(input.ruleId),
    message: input.message,
    ...(input.file ? { file: input.file } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(getRule(input.ruleId) ? { helpUrl: helpUrlFor(input.ruleId) } : {}),
  };
}

/** @param {LegacyFinding} legacy @returns {Finding} */
export function fromLegacyFinding(legacy) {
  return createFinding({
    ruleId: legacy.code,
    severity: legacy.level === 'warn' ? 'warning' : 'error',
    message: legacy.message,
    file: legacy.file,
  });
}

/** @param {Diagnostic} diagnostic @returns {Finding} */
export function fromDiagnostic(diagnostic) {
  return createFinding({
    ruleId: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: portablePath(diagnostic.sourcePath),
    url: diagnostic.pathname,
  });
}

/** @param {GraphFinding} graph @returns {Finding} */
export function fromGraphFinding(graph) {
  return createFinding({
    ruleId: graph.code,
    severity: graph.severity,
    message: graph.message,
    url: graph.pathname,
    evidence: graph.pointer ?? graph.entityId,
  });
}

/** @param {SitemapFinding} sitemap @returns {Finding} */
export function fromSitemapFinding(sitemap) {
  return createFinding({
    ruleId: sitemap.code,
    severity: sitemap.severity,
    message: sitemap.message,
    file: portablePath(sitemap.sourcePath),
    url: sitemap.pathname,
  });
}

/**
 * Project findings back onto the frozen `validate` result. Info findings have no
 * legacy level and are dropped; counters come from the caller because the
 * findings do not record them.
 *
 * @param {readonly Finding[]} findings
 * @param {{ pagesChecked?: number; artifactsChecked?: number; sitemapsChecked?: number }} [counts]
 * @returns {ValidateResult}
 */
export function toValidateResult(findings, counts = {}) {
  /** @type {LegacyFinding[]} */
  const errors = [];
  /** @type {LegacyFinding[]} */
  const warnings = [];
  for (const finding of findings) {
    if (finding.severity === 'info') continue;
    /** @type {LegacyFinding} */
    const legacy = {
      level: finding.severity === 'error' ? 'error' : 'warn',
      code: finding.ruleId,
      message: finding.message,
      ...(finding.file ? { file: finding.file } : {}),
    };
    (legacy.level === 'error' ? errors : warnings).push(legacy);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pagesChecked: counts.pagesChecked ?? 0,
    artifactsChecked: counts.artifactsChecked ?? 0,
    sitemapsChecked: counts.sitemapsChecked ?? 0,
  };
}

/**
 * A source path is reported only when it is project relative. Absolute paths,
 * drive letters and URLs would leak the build machine's layout into a report.
 *
 * @param {string | undefined} value
 */
function portablePath(value) {
  if (!value) return undefined;
  if (value.startsWith('/') || value.startsWith('\\')) return undefined;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return undefined;
  return value;
}
