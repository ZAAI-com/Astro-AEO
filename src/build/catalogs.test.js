import { describe, expect, test, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCatalogPages, preloadCatalogModules, resolveCatalogSpecifier } from './catalogs.js';

describe('catalog module preflight', () => {
  test('keeps successful modules and reports import failures once', async () => {
    const warnings = [];
    const diagnostics = [];
    const load = vi.fn(async (specifier) => {
      if (specifier.endsWith('/broken.js')) throw new SyntaxError('SECRET Unexpected token');
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
    expect(warnings[0]).not.toContain('SECRET');
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'catalog-load-failed',
        severity: 'warning',
        sourcePath: './broken.js',
      }),
    ]);
  });

  test.each(['.ts', '.tsx', '.mts', '.cts', '.jsx', '.astro'])(
    'skips a project-local %s catalog before native import',
    async (extension) => {
      const warnings = [];
      const diagnostics = [];
      const load = vi.fn();

      const modules = await preloadCatalogModules(
        [{ module: `./catalog${extension}` }],
        '/project',
        { warn: (message) => warnings.push(message) },
        diagnostics,
        load,
      );

      expect(modules).toEqual([]);
      expect(load).not.toHaveBeenCalled();
      expect(warnings).toEqual([
        expect.stringContaining('must be compiled to .js, .mjs, or .cjs'),
      ]);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'catalog-unsupported-module-format',
          severity: 'warning',
          sourcePath: `./catalog${extension}`,
        }),
      ]);
    },
  );

  test('lets Node resolve a bare package subpath regardless of its spelling', async () => {
    const load = vi.fn(async () => ({ default: { listPages: () => [] } }));

    const modules = await preloadCatalogModules(
      [{ module: '@example/catalog.ts' }],
      '/project',
      { warn() {} },
      [],
      load,
    );

    expect(modules).toHaveLength(1);
    expect(load).toHaveBeenCalledWith('@example/catalog.ts');
  });

  test('classifies absolute filesystem paths as local modules', async () => {
    const absolute = resolve('/project', 'catalog.ts');
    const load = vi.fn();
    const diagnostics = [];
    const modules = await preloadCatalogModules(
      [{ module: absolute }],
      '/unused',
      { warn() {} },
      diagnostics,
      load,
    );

    expect(resolveCatalogSpecifier(absolute, '/unused')).toBe(pathToFileURL(absolute).href);
    expect(modules).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'catalog-unsupported-module-format' }),
    ]);
  });

  test.each(['file:///project/catalog%2Ets', 'FILE:///project/catalog.ts'])(
    'decodes and case-normalizes the local URL %s before classifying it',
    async (module) => {
      const load = vi.fn();
      const diagnostics = [];
      const modules = await preloadCatalogModules(
        [{ module }],
        '/unused',
        { warn() {} },
        diagnostics,
        load,
      );

      expect(modules).toEqual([]);
      expect(load).not.toHaveBeenCalled();
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'catalog-unsupported-module-format',
          sourcePath: module,
        }),
      ]);
    },
  );

  test.each(['./catalog.ts?raw', './catalog.ts#source'])(
    'rejects a project-local TypeScript catalog with a URL suffix: %s',
    async (module) => {
      const load = vi.fn();
      const diagnostics = [];
      const modules = await preloadCatalogModules(
        [{ module }],
        '/project',
        { warn() {} },
        diagnostics,
        load,
      );

      expect(modules).toEqual([]);
      expect(load).not.toHaveBeenCalled();
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'catalog-unsupported-module-format',
          sourcePath: module,
        }),
      ]);
      expect(resolveCatalogSpecifier(module, '/project')).toBe(
        `file:///project/catalog.ts${module.slice('./catalog.ts'.length)}`,
      );
    },
  );
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

  test('preserves the complete serializable page descriptor shape', async () => {
    const descriptor = {
      pathname: '/rich',
      routePattern: '/rich/[slug]',
      rendering: 'on-demand',
      title: 'Rich page',
      description: 'Complete catalog metadata.',
      image: '/images/rich.png',
      language: 'de',
      markdown: '# Rich',
      dates: { published: '2026-01-02', modified: '2026-02-03T04:05:06Z' },
      authors: [{ name: 'Ada' }],
      entities: [{ '@type': 'Thing', name: 'Catalog entity' }],
      directives: {
        index: false,
        includeInLlms: true,
        includeInLlmsFull: false,
        generateMarkdown: true,
        ignored: 'not-a-directive',
      },
      lastModified: '2026-03-04',
      sourcePath: 'cms:rich',
      source: { kind: 'cms', path: 'cms:rich', body: '# Rich', hash: 'sha256:rich' },
      extraction: {
        strategy: 'catalog',
        selectedNodes: 0,
        removedNodes: 0,
        inputCharacters: 6,
        outputCharacters: 6,
      },
    };

    const pages = await loadCatalogPages(
      [{ module: './catalog.js' }],
      async () => ({ default: { listPages: () => [descriptor] } }),
      { warn() {} },
      {
        command: 'build',
        siteUrl: 'https://example.test',
        base: '',
        trailingSlash: 'ignore',
      },
    );

    expect(pages).toEqual([{
      ...descriptor,
      dates: {
        published: '2026-01-02T00:00:00.000Z',
        modified: '2026-02-03T04:05:06.000Z',
      },
      directives: {
        index: false,
        includeInLlms: true,
        includeInLlmsFull: false,
        generateMarkdown: true,
      },
      lastModified: '2026-03-04T00:00:00.000Z',
    }]);
  });

  test('diagnoses and removes invalid nested catalog dates', async () => {
    const diagnostics = [];
    const pages = await loadCatalogPages(
      [{ module: './catalog.js' }],
      async () => ({
        default: {
          listPages: () => [{
            pathname: '/dated',
            dates: { published: 'not-a-date', modified: 'also-invalid' },
          }],
        },
      }),
      { warn() {} },
      {
        command: 'build',
        siteUrl: 'https://example.test',
        base: '',
        trailingSlash: 'ignore',
      },
      diagnostics,
    );

    expect(pages).toEqual([{ pathname: '/dated', dates: {} }]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'catalog-invalid-date', pathname: '/dated' }),
      expect.objectContaining({ code: 'catalog-invalid-date', pathname: '/dated' }),
    ]);
  });
});
