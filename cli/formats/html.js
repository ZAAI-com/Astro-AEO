// @ts-check
import { escapeXml, place } from './shared.js';

const STYLE = 'body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}'
  + 'table{border-collapse:collapse;width:100%;margin:1rem 0}'
  + 'th,td{text-align:left;padding:.35rem .6rem;border-bottom:1px solid #ddd;vertical-align:top}'
  + '.overall{font-size:2.5rem;margin:0}.error td:first-child{color:#b00020;font-weight:600}'
  + '.warning td:first-child{color:#8a5a00;font-weight:600}code{background:#f3f3f3;padding:0 .25rem}'
  + 'small{font-weight:400;color:#666}';

/**
 * A self-contained page: no script and no remote asset.
 *
 * @param {import('../../src/index.js').AuditReportV1} report
 */
export function renderHtml(report) {
  const { errors, warnings, infos, pagesChecked } = report.summary;
  const scoreRows = report.scores?.categories
    .map((entry) => `<tr><td>${escapeXml(entry.category)}</td><td>${entry.score}</td><td>${entry.findings}</td></tr>`)
    .join('');
  const scores = report.scores
    ? `<h2>Readiness <small>(advisory, ${escapeXml(report.scores.rubric)})</small></h2>\n`
      + `<p class="overall">${report.scores.overall}</p>\n`
      + `<table><thead><tr><th>Category</th><th>Score</th><th>Findings</th></tr></thead><tbody>${scoreRows}</tbody></table>`
    : '';
  const rows = report.findings.map((finding) => {
    // Only the registry's own https help links become anchors.
    const rule = finding.helpUrl?.startsWith('https://')
      ? `<a href="${escapeXml(finding.helpUrl)}">${escapeXml(finding.ruleId)}</a>`
      : escapeXml(finding.ruleId);
    const evidence = finding.evidence ? ` <code>${escapeXml(finding.evidence)}</code>` : '';
    return `<tr class="${finding.severity}"><td>${finding.severity}</td><td>${escapeXml(finding.category)}</td>`
      + `<td>${rule}</td><td>${escapeXml(place(finding))}</td><td>${escapeXml(finding.message)}${evidence}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Astro-AEO audit</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>
</head><body>
<h1>Astro-AEO audit</h1>
<p>Target: <code>${escapeXml(report.target.value)}</code>. ${errors} error(s), ${warnings} warning(s), ${infos} note(s) across ${pagesChecked} page(s).</p>
${scores}
<h2>Findings</h2>
<table><thead><tr><th>Severity</th><th>Category</th><th>Rule</th><th>Where</th><th>Message</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>
`;
}
