// @ts-check
import { printable } from './shared.js';

const COMMANDS = Object.freeze({ error: 'error', warning: 'warning', info: 'notice' });

/** Workflow command data. @param {string} value */
function data(value) {
  return printable(value).replace(/%/g, '%25');
}

/** Workflow command property: `:` and `,` also delimit. @param {string} value */
function property(value) {
  return data(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** GitHub Actions annotations. @param {import('../../src/index.js').AuditReportV1} report */
export function renderGithub(report) {
  const lines = report.findings.map((finding) => {
    const properties = [`title=${property(finding.ruleId)}`];
    if (finding.file) properties.unshift(`file=${property(finding.file.replace(/^\//, ''))}`);
    if (finding.file && finding.location) properties.push(`line=${finding.location.line}`);
    return `::${COMMANDS[finding.severity]} ${properties.join(',')}::${data(finding.message)}`;
  });
  const { errors, warnings, infos } = report.summary;
  lines.push(`astro-aeo audit: ${errors} error(s), ${warnings} warning(s), ${infos} note(s)`);
  return `${lines.join('\n')}\n`;
}
