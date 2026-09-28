import { AUDIT_CATEGORIES } from '../src/audit/rules.js';
import { SCORE_RUBRIC } from '../src/audit/score.js';

const SEVERITIES = ['info', 'warning', 'error'];
const count = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 };

/** @param {Record<string, unknown>} properties @param {string[]} required */
function object(properties, required) {
  return { type: 'object', additionalProperties: false, required, properties };
}

/** The wire contract for `astro-aeo audit --format json`. */
export function buildAuditReportSchema() {
  const category = { enum: [...AUDIT_CATEGORIES] };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://raw.githubusercontent.com/ZAAI-com/Astro-AEO/main/schema/audit-report-v1.schema.json',
    title: 'Astro-AEO audit report, version 1',
    ...object({
      version: { const: 1 },
      tool: object({ name: { const: 'astro-aeo' }, version: { type: 'string' } }, ['name', 'version']),
      target: object({ kind: { enum: ['dist', 'url'] }, value: { type: 'string' } }, ['kind', 'value']),
      scope: object({
        origins: { type: 'array', items: { type: 'string' } },
        maxPages: { anyOf: [positive, { const: 'unlimited' }] },
        pagesFetched: count,
        truncated: { type: 'boolean' },
        skippedExternal: count,
      }, ['origins', 'maxPages', 'pagesFetched', 'truncated', 'skippedExternal']),
      summary: object(
        { errors: count, warnings: count, infos: count, pagesChecked: count },
        ['errors', 'warnings', 'infos', 'pagesChecked'],
      ),
      scores: object({
        rubric: { const: SCORE_RUBRIC },
        overall: { type: 'number', minimum: 0, maximum: 100 },
        categories: {
          type: 'array',
          items: object(
            { category, score: { type: 'number', minimum: 0, maximum: 100 }, findings: count },
            ['category', 'score', 'findings'],
          ),
        },
      }, ['rubric', 'overall', 'categories']),
      findings: {
        type: 'array',
        items: object({
          version: { const: 1 },
          ruleId: { type: 'string', minLength: 1 },
          severity: { enum: SEVERITIES },
          category,
          message: { type: 'string' },
          file: { type: 'string' },
          url: { type: 'string' },
          location: object(
            { line: positive, column: positive, endLine: positive, endColumn: positive },
            ['line'],
          ),
          evidence: { type: 'string' },
          helpUrl: { type: 'string' },
          deduction: { type: 'number', minimum: 0 },
        }, ['version', 'ruleId', 'severity', 'category', 'message']),
      },
    }, ['version', 'tool', 'target', 'summary', 'findings']),
  };
}

export function serializeAuditReportSchema() {
  // Compact for the same reason as the configuration schema: package size.
  return `${JSON.stringify(buildAuditReportSchema())}\n`;
}
