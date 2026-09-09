import { test, expect, describe } from 'vitest';
import { formatReport } from './report.js';

/** @param {Partial<import('./validate.js').ValidateResult>} [over] */
const result = (over = {}) => ({
  ok: true,
  errors: [],
  warnings: [],
  pagesChecked: 1,
  artifactsChecked: 2,
  sitemapsChecked: 3,
  ...over,
});

describe('formatReport', () => {
  test('PASS when there are no errors and not strict', () => {
    expect(formatReport(result())).toContain('- PASS');
    expect(formatReport(result())).toContain('1 page(s), 2 artifact(s), 3 sitemap document(s)');
  });

  test('FAIL when there are errors', () => {
    const r = result({ ok: false, errors: [{ level: 'error', code: 'x', message: 'm' }] });
    expect(formatReport(r)).toContain('- FAIL');
  });

  test('strict + warnings reports FAIL to match the exit code', () => {
    const r = result({ warnings: [{ level: 'warn', code: 'w', message: 'm' }] });
    expect(formatReport(r, { strict: true })).toContain('- FAIL');
    // without --strict the same result still passes
    expect(formatReport(r)).toContain('- PASS');
  });
});
