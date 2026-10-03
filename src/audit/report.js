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
    || (left.location?.endLine ?? 0) - (right.location?.endLine ?? 0)
    || (left.location?.endColumn ?? 0) - (right.location?.endColumn ?? 0)
    || compareCodeUnits(left.locationSource ?? '',right.locationSource ?? '')
    || compareCodeUnits(left.message, right.message)
    || compareCodeUnits(left.evidence ?? '', right.evidence ?? '');
}

/**
 * Assemble the versioned report. It carries no timestamp and no absolute path:
 * it is a pure function of the supplied findings and report inputs. Opt-in
 * freshness findings also depend on the audit date captured by the producer.
 *
 * @param {{
 *   toolVersion: string;
 *   target: AuditReportV1['target'];
 *   findings: readonly Finding[];
 *   pagesChecked?: number;
 *   languageCount?: number;
 *   applicability?: readonly import('../index.js').AuditApplicability[];
 *   scope?: AuditReportV1['scope'];
 *   score?: boolean;
 * }} input
 * @returns {AuditReportV1}
 */
export function createAuditReport(input) {
  const sorted = input.findings.map((finding) => ({...finding,message:redactCredentialUrls(finding.message),
    ...(finding.url ? {url:redactCredentialUrls(finding.url)} : {}),
    ...(finding.evidence ? {evidence:redactCredentialUrls(finding.evidence)} : {})})).sort(compareFindings);
  const scored = input.score === false
    ? null
    : scoreFindings(sorted, { languageCount: input.languageCount, applicability:input.applicability });
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

/** Authored canonical/link evidence can contain a credentialed URL. Public
 * audit exports omit its credentials and query without changing validator bytes.
 * @param {string} text */
function redactCredentialUrls(text) {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi,(candidate) => {
    try {
      const url = new URL(candidate);
      if (!url.username && !url.password) return candidate;
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.href;
    } catch {return 'https://[invalid URL omitted]';}
  });
}
