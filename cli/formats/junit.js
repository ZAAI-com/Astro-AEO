// @ts-check
import { escapeXml, place } from './shared.js';

/**
 * One suite per category, one case per finding. Info findings pass.
 *
 * @param {import('../../src/index.js').AuditReportV1} report
 */
export function renderJunit(report) {
  /** @type {Map<string, import('../../src/index.js').Finding[]>} */
  const suites = new Map();
  for (const finding of report.findings) {
    const suite = suites.get(finding.category);
    if (suite) suite.push(finding);
    else suites.set(finding.category, [finding]);
  }
  const failing = report.summary.errors + report.summary.warnings;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="astro-aeo audit" tests="${report.findings.length}" failures="${failing}">`,
  ];
  for (const [category, findings] of suites) {
    const failures = findings.filter((finding) => finding.severity !== 'info').length;
    lines.push(`  <testsuite name="${escapeXml(category)}" tests="${findings.length}" failures="${failures}">`);
    for (const finding of findings) {
      const name = `${finding.ruleId} ${place(finding)}`.trim();
      const open = `    <testcase classname="astro-aeo.${escapeXml(category)}" name="${escapeXml(name)}"`;
      if (finding.severity === 'info') {
        lines.push(`${open}><system-out>${escapeXml(finding.message)}</system-out></testcase>`);
      } else {
        lines.push(`${open}><failure type="${finding.severity}" message="${escapeXml(finding.message)}"/></testcase>`);
      }
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}
