import { describe, expect, test, vi } from 'vitest';
import { loadCatalogPages, preloadCatalogModules } from './catalogs.js';

describe('catalog module preflight', () => {
  test('keeps successful modules and reports import failures once', async () => {
    const warnings = [];
    const diagnostics = [];
    const load = vi.fn(async (specifier) => {
      if (specifier.endsWith('/broken.js')) throw new SyntaxError('Unexpected token');
      return { default: { listPages: () => [] } };
    });

    const modules = await preloadCatalogModules(
      [{ module: './healthy.js' }, { module: './broken.js' }],
      '/project',
      { warn: (message) => warnings.push(message) },
      diagnostics,
      load,
    );

    expect(modules).toEqual([
      expect.objectContaining({
        module: './healthy.js',
        specifier: 'file:///project/healthy.js',
      }),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('./broken.js');
    expect(warnings[0]).toContain('Unexpected token');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'catalog-load-failed',
        severity: 'warning',
        sourcePath: './broken.js',
      }),
    ]);
  });
});

describe('catalog pathname validation', () => {
  test('rejects traversal before a descriptor reaches the build collector', async () => {
    const warnings = [];
    const diagnostics = [];
    const listPages = vi.fn(() => [
      { pathname: '/safe', markdown: '# Safe' },
      { pathname: '/../outside', markdown: '# Secret' },
      { pathname: '/%252e%252e/outside', markdown: '# Secret' },
      { pathname: '/safe\\..\\outside', markdown: '# Secret' },
    ]);
    const pages = await loadCatalogPages(
      [{ module: './catalog.js' }],
      async () => ({ default: { listPages } }),
      { warn: (message) => warnings.push(message) },
      {
        command: 'build',
        siteUrl: 'https://example.test',
        base: '',
        trailingSlash: 'ignore',
      },
      diagnostics,
    );

    expect(pages).toEqual([{ pathname: '/safe', markdown: '# Safe' }]);
    expect(warnings).toHaveLength(3);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((finding) => finding.code === 'catalog-invalid-pathname')).toBe(true);
  });
});
