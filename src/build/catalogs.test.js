import { describe, expect, test, vi } from 'vitest';
import { loadCatalogPages } from './catalogs.js';

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
