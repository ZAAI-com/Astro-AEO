// @ts-check

const LEVELS = Object.freeze({ error: 'error', warning: 'warning', info: 'note' });

/**
 * SARIF 2.1.0. Only a finding with a file gets a physical location: code
 * scanning resolves `uri` against the repository, and a page URL is not a file.
 *
 * @param {import('../../src/index.js').AuditReportV1} report
 */
export function renderSarif(report) {
  /** @type {Map<string, import('../../src/index.js').Finding>} */
  const rules = new Map();
  for (const finding of report.findings) if (!rules.has(finding.ruleId)) rules.set(finding.ruleId, finding);
  const ruleIds = [...rules.keys()];
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'astro-aeo',
          version: report.tool.version,
          informationUri: 'https://github.com/ZAAI-com/Astro-AEO',
          rules: [...rules.values()].map((sample) => ({
            id: sample.ruleId,
            shortDescription: { text: sample.ruleId },
            ...(sample.helpUrl ? { helpUri: sample.helpUrl } : {}),
            properties: { category: sample.category },
          })),
        },
      },
      results: report.findings.map((finding) => ({
        ruleId: finding.ruleId,
        ruleIndex: ruleIds.indexOf(finding.ruleId),
        level: LEVELS[finding.severity],
        message: { text: finding.message },
        ...(finding.file ? {
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: encodeURI(finding.file.replace(/^\//, '')), uriBaseId: 'AUDITROOT' },
              ...(finding.location ? {
                region: {
                  startLine: finding.location.line,
                  ...(finding.location.column ? { startColumn: finding.location.column } : {}),
                },
              } : {}),
            },
          }],
        } : {}),
        properties: {
          category: finding.category,
          ...(finding.url ? { url: finding.url } : {}),
          ...(finding.evidence ? { evidence: finding.evidence } : {}),
        },
      })),
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
