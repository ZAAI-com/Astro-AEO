// @ts-check
import { describe, expect, it } from 'vitest';
import { createFinding } from '../../src/audit/finding.js';
import { createAuditReport } from '../../src/audit/report.js';
import { AUDIT_FORMATS, isAuditFormat, renderAuditReport } from './index.js';

const ESCAPE = String.fromCharCode(27);
const HOSTILE = `</td><script>alert(1)</script> "q" 'a' & | \`x\` ${ESCAPE}[31mred\nsecond::error::forged line`;

const report = createAuditReport({
  toolVersion: '1.4.0',
  target: { kind: 'dist', value: 'dist' },
  pagesChecked: 2,
  findings: [
    createFinding({ ruleId: 'orphan-md', severity: 'warning', message: HOSTILE, file: '/a,b:c.md', location: { line: 3, column: 2 }, evidence: '<b>' }),
    createFinding({ ruleId: 'schema.invalid-id', severity: 'error', message: 'bad id', url: '/page/' }),
    createFinding({ ruleId: 'live-external-skipped', severity: 'info', message: 'skipped', url: 'https://x.example' }),
  ],
});
const clean = createAuditReport({ toolVersion: '1.4.0', target: { kind: 'dist', value: 'dist' }, findings: [], score: false });

describe('audit report formats', () => {
  it('knows exactly the seven formats', () => {
    expect(Object.keys(AUDIT_FORMATS)).toEqual(['terminal', 'json', 'sarif', 'html', 'markdown', 'github', 'junit']);
    expect(isAuditFormat('sarif')).toBe(true);
    expect(isAuditFormat('toString')).toBe(false);
  });

  it.each(Object.keys(AUDIT_FORMATS))('%s renders a clean, unscored report', (format) => {
    const output = renderAuditReport(clean, /** @type {keyof typeof AUDIT_FORMATS} */ (format));
    expect(output.endsWith('\n')).toBe(true);
    expect(output).not.toContain('astro-aeo-readiness-v1');
  });

  it.each(['terminal', 'markdown', 'github', 'junit', 'html'])('%s never emits a raw control character', (format) => {
    const output = renderAuditReport(report, /** @type {keyof typeof AUDIT_FORMATS} */ (format));
    expect(output).not.toContain(ESCAPE);
  });

  it('terminal keeps one finding on one line', () => {
    const lines = renderAuditReport(report, 'terminal').split('\n').filter((line) => line.includes('[orphan-md]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('second::error::forged line (/a,b:c.md:3:2)');
  });

  it('json round-trips the report', () => {
    expect(JSON.parse(renderAuditReport(report, 'json'))).toEqual(report);
  });

  it('sarif maps severities, indexes rules and locates only files', () => {
    const sarif = JSON.parse(renderAuditReport(report, 'sarif'));
    const run = sarif.runs[0];
    expect(sarif.version).toBe('2.1.0');
    expect(run.tool.driver.rules.map((/** @type {any} */ rule) => rule.id)).toEqual(report.findings.map((finding) => finding.ruleId));
    expect(run.results.map((/** @type {any} */ result) => result.level).sort()).toEqual(['error', 'note', 'warning']);
    for (const result of run.results) expect(run.tool.driver.rules[result.ruleIndex].id).toBe(result.ruleId);
    const located = run.results.find((/** @type {any} */ result) => result.ruleId === 'orphan-md');
    expect(located.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'a,b:c.md', uriBaseId: 'AUDITROOT' },
      region: { startLine: 3, startColumn: 2 },
    });
    expect(located.message.text).toBe(HOSTILE);
    expect(run.results.find((/** @type {any} */ result) => result.ruleId === 'schema.invalid-id').locations).toBeUndefined();
  });

  it('html escapes audited text and links only registry help URLs', () => {
    const output = renderAuditReport(report, 'html');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &#39;a&#39; &amp;');
    expect(output).toContain('<code>&lt;b&gt;</code>');
    const hostile = { ...report, findings: [{ ...report.findings[0], helpUrl: 'javascript:alert(1)' }] };
    expect(renderAuditReport(hostile, 'html')).not.toContain('href="javascript:');
  });

  it('markdown escapes table and inline syntax', () => {
    const row = renderAuditReport(report, 'markdown').split('\n').find((line) => line.includes('orphan-md')) ?? '';
    expect(row).toContain('\\<script\\>');
    expect(row).toContain('\\|');
    expect(row).toContain('\\`x\\`');
    // Four cells: five unescaped pipes.
    expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(6);
  });

  it('github escapes command delimiters so a message cannot forge an annotation', () => {
    const lines = renderAuditReport(report, 'github').trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.filter((line) => line.startsWith('::'))).toHaveLength(3);
    const warning = lines.find((line) => line.startsWith('::warning')) ?? '';
    expect(warning.startsWith('::warning file=a%2Cb%3Ac.md,title=orphan-md,line=3::')).toBe(true);
    expect(lines.find((line) => line.startsWith('::notice'))).toBeDefined();
    const percent = { ...report, findings: [{ ...report.findings[0], message: '100%0A::error::x' }] };
    expect(renderAuditReport(percent, 'github')).toContain('100%250A::error::x');
  });

  it('junit is well formed, fails errors and warnings, and passes notes', () => {
    const output = renderAuditReport(report, 'junit');
    expect(output).toContain('<testsuites name="astro-aeo audit" tests="3" failures="2">');
    expect(output).toContain('&lt;/td&gt;&lt;script&gt;');
    expect(output.match(/<failure /g)).toHaveLength(2);
    expect(output.match(/<system-out>/g)).toHaveLength(1);
    expect(output.match(/<testsuite /g)?.length).toBe(output.match(/<\/testsuite>/g)?.length);
    const attributes = output.match(/="[^"]*"/g) ?? [];
    expect(attributes.every((attribute) => !/[<>]/.test(attribute))).toBe(true);
  });
});
