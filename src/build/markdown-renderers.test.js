import { describe, expect, test, vi } from 'vitest';
import {
  assertInlineMarkdownRenderersSupported,
  orderMarkdownRenderers,
  preloadMarkdownRenderers,
  resolveRendererSpecifier,
  runtimeMarkdownRendererModules,
} from './markdown-renderers.js';

describe('Markdown renderer preflight', () => {
  test('promotes the explicit MDX adapter and otherwise preserves configuration order', () => {
    const first = { module: './first.js' };
    const mdx = { module: ' astro-aeo/mdx ' };
    const last = { module: './last.js' };
    expect(orderMarkdownRenderers([first, mdx, last])).toEqual([mdx, first, last]);
    expect(() => orderMarkdownRenderers([mdx, mdx])).toThrow(/only once/);
  });

  test('preflights modules, clones options, and omits recoverable load failures', async () => {
    const warnings = [];
    const diagnostics = [];
    const render = () => ({ status: 'decline' });
    const load = vi.fn(async (specifier) => {
      if (specifier.endsWith('/broken.js')) throw new Error('SECRET missing optional peer');
      return { default: { name: 'custom', apiVersion: 1, render } };
    });
    const configuredOptions = { nested: { value: 1 } };
    const loaded = await preloadMarkdownRenderers(
      [
        { module: './custom.js', options: configuredOptions },
        { module: './broken.js' },
      ],
      '/project',
      { warn: (message) => warnings.push(message) },
      diagnostics,
      load,
    );

    expect(load.mock.calls.map(([specifier]) => specifier)).toEqual([
      'file:///project/custom.js',
      'file:///project/broken.js',
    ]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      name: 'custom',
      module: './custom.js',
      specifier: 'file:///project/custom.js',
      inline: false,
      render,
    });
    configuredOptions.nested.value = 2;
    expect(loaded[0].options).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(loaded[0].options.nested)).toBe(true);
    expect(warnings[0]).toMatch(/rendered HTML extraction remains available/);
    expect(warnings[0]).not.toContain('SECRET');
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'markdown-renderer-load-failed',
        severity: 'warning',
        sourcePath: './broken.js',
      }),
    ]);
  });

  test('rejects remote modules and duplicate preflight names', async () => {
    await expect(preloadMarkdownRenderers(
      [{ module: 'https://example.test/renderer.js' }],
      '/project',
      { warn() {} },
      [],
      vi.fn(),
    )).rejects.toThrow(/remote modules are not supported/);

    const diagnostics = [];
    const loaded = await preloadMarkdownRenderers(
      [{ module: './one.js' }, { module: './two.js' }],
      '/project',
      { warn() {} },
      diagnostics,
      async () => ({ default: { name: 'same', apiVersion: 1, render: () => ({ status: 'decline' }) } }),
    );
    expect(loaded).toHaveLength(1);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'markdown-renderer-duplicate-name', sourcePath: './two.js' }),
    ]);
  });

  test('carries only importable literal module data into runtime bundles', async () => {
    const inline = () => ({ status: 'decline' });
    const loaded = await preloadMarkdownRenderers(
      [inline, { module: 'pkg/renderer', options: { locale: 'en' } }],
      '/project',
      { warn() {} },
      [],
      async () => ({ default: { name: 'package-renderer', apiVersion: 1, render: inline } }),
    );
    expect(runtimeMarkdownRendererModules(loaded)).toEqual([{
      name: 'package-renderer',
      module: 'pkg/renderer',
      specifier: 'pkg/renderer',
      options: { locale: 'en' },
    }]);
  });
});

describe('inline renderer compatibility', () => {
  const inline = () => ({ status: 'decline' });

  test('allows inline handlers only in a fully prerendered build', () => {
    expect(() => assertInlineMarkdownRenderersSupported([inline], {
      command: 'build', serverOutput: false, hasOnDemandPage: false,
    })).not.toThrow();
    for (const environment of [
      { command: 'dev', serverOutput: false, hasOnDemandPage: false },
      { command: 'preview', serverOutput: false, hasOnDemandPage: false },
      { command: 'build', serverOutput: true, hasOnDemandPage: false },
      { command: 'build', serverOutput: false, hasOnDemandPage: true },
    ]) {
      expect(() => assertInlineMarkdownRenderersSupported([inline], environment)).toThrow(
        /only by fully prerendered builds/,
      );
    }
  });

  test('resolves project-relative files and preserves bare package imports', () => {
    expect(resolveRendererSpecifier('./renderer.js', '/project')).toBe('file:///project/renderer.js');
    expect(resolveRendererSpecifier('pkg/renderer', '/project')).toBe('pkg/renderer');
    expect(resolveRendererSpecifier('C:\\project\\renderer.mjs', '/project'))
      .toBe('file:///C:/project/renderer.mjs');
    expect(resolveRendererSpecifier('C:\\project\\renderer.mjs?raw', '/project'))
      .toBe('file:///C:/project/renderer.mjs?raw');
    expect(resolveRendererSpecifier(String.raw`\\server\share\renderer.mjs`, '/project'))
      .toBe('file://server/share/renderer.mjs');
  });
});
