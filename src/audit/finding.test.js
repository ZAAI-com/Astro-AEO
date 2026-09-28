// @ts-check
import { describe, expect, it } from 'vitest';
import {
  fromDiagnostic,
  fromGraphFinding,
  fromLegacyFinding,
  fromSitemapFinding,
  toValidateResult,
} from './finding.js';

describe('finding adapters', () => {
  it('adapts a validator finding and maps warn to warning', () => {
    expect(fromLegacyFinding({ level: 'warn', code: 'orphan-md', message: 'm', file: '/a.md' })).toEqual({
      version: 1,
      ruleId: 'orphan-md',
      severity: 'warning',
      category: 'markdown',
      message: 'm',
      file: '/a.md',
      helpUrl: expect.stringMatching(/#orphan-md$/),
    });
  });

  it('adapts a build diagnostic, keeps its severity and drops details', () => {
    const finding = fromDiagnostic({
      version: 1,
      code: 'catalog-load-failed',
      severity: 'error',
      message: 'm',
      pathname: '/docs/',
      sourcePath: 'src/catalog.js',
      details: { secret: 'value' },
    });
    expect(finding).toMatchObject({ severity: 'error', category: 'build', url: '/docs/', file: 'src/catalog.js' });
    expect(JSON.stringify(finding)).not.toContain('secret');
  });

  it.each(['/Users/me/site/src/catalog.js', 'C:\\site\\catalog.js', 'file:///site/catalog.js', '\\\\host\\share'])(
    'never reports the non-portable source path %s',
    (sourcePath) => {
      const finding = fromDiagnostic({ version: 1, code: 'catalog-load-failed', severity: 'warning', message: 'm', sourcePath });
      expect(finding.file).toBeUndefined();
    },
  );

  it('adapts a graph finding with its pointer as evidence', () => {
    expect(fromGraphFinding({
      version: 1,
      code: 'schema.invalid-id',
      severity: 'error',
      message: 'm',
      pointer: '/0/@id',
      entityId: 'https://example.com/#a',
      pathname: '/',
    })).toMatchObject({ ruleId: 'schema.invalid-id', category: 'structured-data', evidence: '/0/@id', url: '/' });
  });

  it('adapts a sitemap finding', () => {
    expect(fromSitemapFinding({ code: 'sitemap-hreflang-duplicate', severity: 'error', message: 'm', pathname: '/sitemap.xml' }))
      .toMatchObject({ category: 'internationalization', url: '/sitemap.xml' });
  });

  it('omits helpUrl for a code outside the registry', () => {
    expect(fromDiagnostic({ version: 1, code: 'plugin-own-code', severity: 'info', message: 'm' }).helpUrl).toBeUndefined();
  });

  it('round-trips validator findings through the public shape', () => {
    const errors = [{ level: /** @type {const} */ ('error'), code: 'no-llms', message: 'a' }];
    const warnings = [{ level: /** @type {const} */ ('warn'), code: 'orphan-md', message: 'b', file: '/b.md' }];
    const findings = [...errors, ...warnings].map(fromLegacyFinding);
    expect(toValidateResult(findings, { pagesChecked: 3, artifactsChecked: 2, sitemapsChecked: 1 })).toEqual({
      ok: false,
      errors,
      warnings,
      pagesChecked: 3,
      artifactsChecked: 2,
      sitemapsChecked: 1,
    });
  });

  it('drops info findings from the legacy result', () => {
    const result = toValidateResult([fromDiagnostic({ version: 1, code: 'x-y', severity: 'info', message: 'm' })]);
    expect(result).toMatchObject({ ok: true, errors: [], warnings: [] });
  });
});
