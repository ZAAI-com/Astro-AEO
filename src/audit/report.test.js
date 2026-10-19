// @ts-check
import { describe, expect, it } from 'vitest';
import { buildAuditReportSchema } from '../../scripts/audit-report-schema.mjs';
import { createFinding } from './finding.js';
import { createAuditReport, serializeAuditReport } from './report.js';

const findings = [
  createFinding({ ruleId: 'orphan-md', severity: 'warning', message: 'b', file: '/b.md' }),
  createFinding({ ruleId: 'schema.invalid-id', severity: 'error', message: 'c', url: '/' }),
  createFinding({ ruleId: 'orphan-md', severity: 'warning', message: 'a', file: '/a.md' }),
  createFinding({ ruleId: 'no-llms', severity: 'error', message: 'd' }),
];
const base = { toolVersion: '1.4.0', target: { kind: /** @type {const} */ ('dist'), value: 'dist' }, pagesChecked: 2 };

describe('audit report', () => {
  it('orders findings by category, severity, rule and location', () => {
    const report = createAuditReport({ ...base, findings });
    expect(report.findings.map((finding) => `${finding.ruleId}:${finding.file ?? ''}`)).toEqual([
      'no-llms:',
      'orphan-md:/a.md',
      'orphan-md:/b.md',
      'schema.invalid-id:',
    ]);
    expect(report.summary).toEqual({ errors: 2, warnings: 2, infos: 0, pagesChecked: 2 });
  });

  it('serializes to the same bytes whatever order findings were discovered in', () => {
    const forward = serializeAuditReport(createAuditReport({ ...base, findings }));
    const backward = serializeAuditReport(createAuditReport({ ...base, findings: [...findings].reverse() }));
    expect(backward).toBe(forward);
    expect(forward).not.toMatch(/generatedAt|\d{4}-\d{2}-\d{2}T/);
  });

  it('omits scores and deductions when scoring is off', () => {
    const scored = createAuditReport({ ...base, findings });
    expect(scored.scores?.rubric).toBe('astro-aeo-readiness-v2');
    expect(scored.findings.every((finding) => typeof finding.deduction === 'number')).toBe(true);
    const plain = createAuditReport({ ...base, findings: scored.findings, score: false });
    expect(plain.scores).toBeUndefined();
    expect(plain.findings.some((finding) => 'deduction' in finding)).toBe(false);
  });

  it('uses only keys the published wire schema declares', () => {
    const schema = /** @type {any} */ (buildAuditReportSchema());
    const report = createAuditReport({
      ...base,
      findings,
      scope: { origins: ['https://example.com'], maxPages: 500, pagesFetched: 2, truncated: false, skippedExternal: 0 },
    });
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(Object.keys(report)));
    for (const key of schema.required) expect(report).toHaveProperty(key);
    const findingSchema = schema.properties.findings.items;
    for (const finding of report.findings) {
      expect(Object.keys(findingSchema.properties)).toEqual(expect.arrayContaining(Object.keys(finding)));
      for (const key of findingSchema.required) expect(finding).toHaveProperty(key);
    }
    expect(schema.properties.findings.items.properties.category.enum).toContain('structured-data');
  });
});

it('omits credentials and associated queries from authored URL evidence without mutating inputs',() => {
 const secret='https://user:private-password@example.test/page?token=private-token';
 const finding=createFinding({ruleId:'canonical-duplicate',severity:'warning',message:'Shared '+secret,evidence:secret,url:secret});
 const output=serializeAuditReport(createAuditReport({...base,findings:[finding]}));
 expect(output).not.toContain('private-password');expect(output).not.toContain('private-token');expect(output).not.toContain('user:');
 expect(output).toContain('https://example.test/page');expect(finding.evidence).toBe(secret);
});

it('omits credentials embedded in the query of an otherwise plain URL',() => {
 for (const secret of ['https://example.test/login?next=https://user:nested-password@other.test/','https://example.test/a?next=https%3A%2F%2Fuser%3Anested-password%40other.test']) {
  const output=serializeAuditReport(createAuditReport({...base,findings:[createFinding({ruleId:'canonical-duplicate',severity:'warning',message:'Shared '+secret,evidence:secret,url:secret})]}));
  expect(output).not.toContain('nested-password');expect(output).toContain('https://example.test/');
 }
});

it('keeps a plain query that only contains an @ sign',() => {
 const url='https://example.test/search?q=a@b.com';
 const output=serializeAuditReport(createAuditReport({...base,findings:[createFinding({ruleId:'canonical-duplicate',severity:'warning',message:'Shared '+url,evidence:url,url})]}));
 expect(output).toContain('?q=a@b.com');
});
