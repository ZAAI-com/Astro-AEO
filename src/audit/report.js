// @ts-check
import { compareCodeUnits } from '../core/corpus-manifest.js';
import { AUDIT_CATEGORIES } from './rules.js';
import { scoreFindings } from './score.js';

/**
 * @typedef {import('../index.js').Finding} Finding
 * @typedef {import('../index.js').AuditReportV1} AuditReportV1
 */

const SEVERITY_RANK = Object.freeze({ error: 0, warning: 1, info: 2 });

/**
 * Total order over findings, independent of discovery order, so two audits of
 * the same input serialize to the same bytes.
 *
 * @param {Finding} left
 * @param {Finding} right
 */
export function compareFindings(left, right) {
  return AUDIT_CATEGORIES.indexOf(left.category) - AUDIT_CATEGORIES.indexOf(right.category)
    || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || compareCodeUnits(left.ruleId, right.ruleId)
    || compareCodeUnits(left.url ?? '', right.url ?? '')
    || compareCodeUnits(left.file ?? '', right.file ?? '')
    || (left.location?.line ?? 0) - (right.location?.line ?? 0)
    || (left.location?.column ?? 0) - (right.location?.column ?? 0)
    || compareCodeUnits(left.message, right.message)
    || compareCodeUnits(left.evidence ?? '', right.evidence ?? '');
}

/**
 * Assemble the versioned report. It carries no timestamp and no absolute path:
 * it is a pure function of the audited content.
 *
 * @param {{
 *   toolVersion: string;
 *   target: AuditReportV1['target'];
 *   findings: readonly Finding[];
 *   pagesChecked?: number;
 *   languageCount?: number;
 *   scope?: AuditReportV1['scope'];
 *   score?: boolean;
 * }} input
 * @returns {AuditReportV1}
 */
export function createAuditReport(input) {
  const sorted = [...input.findings].sort(compareFindings);
  const scored = input.score === false
    ? null
    : scoreFindings(sorted, { languageCount: input.languageCount });
  const findings = scored
    ? scored.findings
    : sorted.map(({ deduction: _deduction, ...finding }) => finding);
  const count = (/** @type {Finding['severity']} */ severity) =>
    findings.filter((finding) => finding.severity === severity).length;
  return {
    version: 1,
    tool: { name: 'astro-aeo', version: input.toolVersion },
    target: input.target,
    ...(input.scope ? { scope: input.scope } : {}),
    summary: {
      errors: count('error'),
      warnings: count('warning'),
      infos: count('info'),
      pagesChecked: input.pagesChecked ?? 0,
    },
    ...(scored ? { scores: scored.scores } : {}),
    findings,
  };
}

/** Stable serialization shared by the JSON format and the determinism checks. */
export function serializeAuditReport(/** @type {AuditReportV1} */ report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
