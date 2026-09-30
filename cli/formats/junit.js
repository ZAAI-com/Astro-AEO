// @ts-check
import { escapeXml, failsGate, place } from './shared.js';

/**
 * One suite per category, one case per finding. A case fails exactly when its
 * finding fails `--fail-on` (default `error`, as in the CLI), so the report and
 * the exit status agree. Every other finding passes with its message in
 * `<system-out>`, prefixed by its severity unless it is info.
 *
 * @param {import('../../src/index.js').AuditReportV1} report
 * @param {{ failOn?: import('./shared.js').FailOn }} [options]
 */
export function renderJunit(report, { failOn = 'error' } = {}) {
  /** @type {Map<string, import('../../src/index.js').Finding[]>} */
  const suites = new Map();
  for (const finding of report.findings) {
    const suite = suites.get(finding.category);
    if (suite) suite.push(finding);
    else suites.set(finding.category, [finding]);
  }
  /** @param {import('../../src/index.js').Finding} finding */
  const fails = (finding) => failsGate(finding.severity, failOn);
  const failing = report.findings.filter(fails).length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="astro-aeo audit" tests="${report.findings.length}" failures="${failing}">`,
  ];
  for (const [category, findings] of suites) {
    const failures = findings.filter(fails).length;
    lines.push(`  <testsuite name="${escapeXml(category)}" tests="${findings.length}" failures="${failures}">`);
    for (const finding of findings) {
      const name = `${finding.ruleId} ${place(finding)}`.trim();
      const open = `    <testcase classname="astro-aeo.${escapeXml(category)}" name="${escapeXml(name)}"`;
      if (fails(finding)) {
        lines.push(`${open}><failure type="${finding.severity}" message="${escapeXml(finding.message)}"/></testcase>`);
      } else {
        const note = finding.severity === 'info' ? finding.message : `${finding.severity}: ${finding.message}`;
        lines.push(`${open}><system-out>${escapeXml(note)}</system-out></testcase>`);
      }
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}
