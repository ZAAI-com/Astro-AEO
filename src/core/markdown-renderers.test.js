import { describe, expect, test, vi } from 'vitest';
import {
  rendererOptions,
  resolveMarkdownWithRenderers,
  validateMarkdownRendererModule,
} from './markdown-renderers.js';

const input = (overrides = {}) => ({
  pathname: '/guide',
  html: '<html><body><main>Rendered</main></body></html>',
  canonicalUrl: 'https://example.test/guide',
  rendering: 'prerendered',
  extraction: { selectors: ['main'], removeSelectors: [], keepSelectors: [] },
  ...overrides,
});

describe('Markdown renderer dispatch', () => {
  test('runs serially, preserves diagnostics, and accepts empty Markdown', async () => {
    const calls = [];
    const result = await resolveMarkdownWithRenderers([
      {
        name: 'declines',
        render(value) {
          calls.push(['declines', value]);
          return { status: 'decline' };
        },
      },
      {
        name: 'continues',
        render(value) {
          calls.push(['continues', value]);
          return {
            status: 'continue',
            diagnostics: [{ code: 'not-mine', severity: 'info', message: 'Try the next renderer.' }],
          };
        },
      },
      {
        name: 'empty',
        options: rendererOptions({ nested: { enabled: true } }, 'test options'),
        render(value) {
          calls.push(['empty', value]);
          return { status: 'rendered', markdown: '' };
        },
      },
      { name: 'unreachable', render: vi.fn(() => ({ status: 'rendered', markdown: 'no' })) },
    ], input());

    expect(calls.map(([name]) => name)).toEqual(['declines', 'continues', 'empty']);
    expect(result).toMatchObject({
      status: 'rendered',
      renderer: 'empty',
      markdown: '',
      diagnostics: [{ code: 'not-mine', severity: 'info', pathname: '/guide' }],
      extraction: { strategy: 'renderer:empty', outputCharacters: 0 },
    });
    const rendererInput = calls[2][1];
    expect(Object.isFrozen(rendererInput)).toBe(true);
    expect(Object.isFrozen(rendererInput.extraction)).toBe(true);
    expect(Object.isFrozen(rendererInput.extraction.selectors)).toBe(true);
    expect(Object.isFrozen(rendererInput.options.nested)).toBe(true);
  });

  test('diagnoses throws and invalid results before continuing', async () => {
    const result = await resolveMarkdownWithRenderers([
      { name: 'throws', module: './throws.js', render: () => { throw new Error('SECRET boom'); } },
      { name: 'invalid', render: () => ({ status: 'rendered', markdown: 42 }) },
      { name: 'valid', render: () => ({ status: 'rendered', markdown: '# Recovered' }) },
    ], input());

    expect(result.markdown).toBe('# Recovered');
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'markdown-renderer-threw',
      'markdown-renderer-invalid-result',
    ]);
    expect(result.diagnostics[0]).toMatchObject({ sourcePath: './throws.js', pathname: '/guide' });
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  test('honors an immediate rendered-HTML fallback request', async () => {
    const later = vi.fn();
    const result = await resolveMarkdownWithRenderers([
      {
        name: 'semantic-jsx',
        render: () => ({
          status: 'fallback-to-html',
          diagnostics: [{ code: 'unsupported-jsx', message: 'Use rendered HTML.' }],
        }),
      },
      { name: 'later', render: later },
    ], input());

    expect(result.status).toBe('fallback');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'unsupported-jsx', severity: 'warning' }),
    ]);
    expect(later).not.toHaveBeenCalled();
  });
});

describe('Markdown renderer validation', () => {
  test('requires the versioned default-export contract', () => {
    const render = () => ({ status: 'decline' });
    expect(validateMarkdownRendererModule({ name: 'custom', apiVersion: 1, render }, './x.js'))
      .toEqual({ name: 'custom', render });
    expect(() => validateMarkdownRendererModule({ name: 'custom', apiVersion: 2, render }, './x.js'))
      .toThrow(/apiVersion: 1/);
    expect(() => validateMarkdownRendererModule({ name: '', apiVersion: 1, render }, './x.js'))
      .toThrow(/non-empty name/);
  });

  test('rejects non-JSON, cyclic, unsafe, and accessor options', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const accessor = {};
    Object.defineProperty(accessor, 'secret', { enumerable: true, get: () => 'value' });
    expect(() => rendererOptions({ run() {} }, 'options')).toThrow(/strict JSON/);
    expect(() => rendererOptions(cyclic, 'options')).toThrow(/cycles/);
    expect(() => rendererOptions({ value: Number.NaN }, 'options')).toThrow(/finite JSON/);
    expect(() => rendererOptions(accessor, 'options')).toThrow(/accessor/);
    expect(() => rendererOptions(JSON.parse('{"__proto__":true}'), 'options')).toThrow(/forbidden key/);
  });
});
