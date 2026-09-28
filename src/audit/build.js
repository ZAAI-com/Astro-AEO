// @ts-check
import { factsFromPageRecord } from './facts.js';
import { auditPages } from './site-rules.js';

/**
 * The offline audit rules a build can answer from its own page model, as build
 * diagnostics. Used only by `validation.onBuild: 'recommended'`. Link and
 * hreflang rules need the rendered site and stay with `astro-aeo audit`.
 *
 * @param {readonly import('../core/page-model.js').AeoPageRecord[]} pages
 * @returns {import('../index.js').Diagnostic[]}
 */
export function recommendedAuditDiagnostics(pages) {
  return auditPages(pages.map(factsFromPageRecord)).map((finding) => ({
    version: /** @type {const} */ (1),
    code: finding.ruleId,
    severity: finding.severity,
    message: `astro-aeo: ${finding.message}`,
    ...(finding.url ? { pathname: finding.url } : {}),
  }));
}
