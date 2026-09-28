// @ts-check
import { place, printable } from './shared.js';

/** Escape what would otherwise become Markdown or HTML inside a table cell. @param {string} value */
function cell(value) {
  return printable(value).replace(/[\\`*_{}[\]<>|#]/g, (character) => `\\${character}`);
}

/** @param {import('../../src/index.js').AuditReportV1} report */
export function renderMarkdown(report) {
  const { errors, warnings, infos, pagesChecked } = report.summary;
  const lines = [
    '# Astro-AEO audit',
    '',
    `Target: ${cell(report.target.value)}. ${errors} error(s), ${warnings} warning(s), ${infos} note(s) across ${pagesChecked} page(s).`,
    '',
  ];
  if (report.scores) {
    lines.push(
      `Readiness (advisory, ${report.scores.rubric}): **${report.scores.overall}**`,
      '',
      '| Category | Score | Findings |',
      '|---|---:|---:|',
    );
    for (const entry of report.scores.categories) lines.push(`| ${entry.category} | ${entry.score} | ${entry.findings} |`);
    lines.push('');
  }
  if (report.findings.length > 0) {
    lines.push('| Severity | Rule | Where | Message |', '|---|---|---|---|');
    for (const finding of report.findings) {
      const rule = finding.helpUrl ? `[${cell(finding.ruleId)}](${finding.helpUrl})` : cell(finding.ruleId);
      lines.push(`| ${finding.severity} | ${rule} | ${cell(place(finding))} | ${cell(finding.message)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
