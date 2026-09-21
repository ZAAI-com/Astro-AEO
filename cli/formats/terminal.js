// @ts-check
import { place, printable } from './shared.js';

const MARKS = Object.freeze({ error: 'x', warning: '!', info: 'i' });

/** @param {import('../../src/index.js').AuditReportV1} report */
export function renderTerminal(report) {
  /** @type {string[]} */
  const lines = [];
  let category = '';
  for (const finding of report.findings) {
    if (finding.category !== category) {
      category = finding.category;
      if (lines.length > 0) lines.push('');
      lines.push(category);
    }
    const where = place(finding);
    lines.push(printable(`  ${MARKS[finding.severity]} [${finding.ruleId}] ${finding.message}${where ? ` (${where})` : ''}`));
  }
  if (lines.length > 0) lines.push('');
  if (report.scores) {
    for (const entry of report.scores.categories) lines.push(`  ${entry.category.padEnd(22)}${String(entry.score).padStart(6)}`);
    lines.push(`  ${'overall (advisory)'.padEnd(22)}${String(report.scores.overall).padStart(6)}`, '');
  }
  const { errors, warnings, infos, pagesChecked } = report.summary;
  lines.push(printable(
    `astro-aeo audit: ${errors} error(s), ${warnings} warning(s), ${infos} note(s) across ${pagesChecked} page(s) in ${report.target.value}`,
  ));
  return `${lines.join('\n')}\n`;
}
