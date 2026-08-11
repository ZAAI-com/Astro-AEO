import { afterEach, describe, expect, test, vi } from 'vitest';
import renderer from './defuddle.js';

afterEach(() => vi.restoreAllMocks());

const input = (overrides = {}) => ({
  pathname: '/article',
  html:
    '<!doctype html><html><head><title>Article</title></head><body>' +
    '<nav>Navigation</nav><article><h1>Useful title</h1><p>Useful body.</p></article>' +
    '<footer>Footer</footer></body></html>',
  canonicalUrl: 'https://example.test/article',
  rendering: 'prerendered',
  extraction: { selectors: ['article'], removeSelectors: ['nav', 'footer'], keepSelectors: [] },
  ...overrides,
});

describe('astro-aeo/defuddle', () => {
  test('cleans already-rendered local HTML and uses the shared Markdown converter', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const result = await renderer.render(input());
    expect(result).toMatchObject({ status: 'rendered' });
    expect(result.markdown).toContain('# Useful title');
    expect(result.markdown).toContain('Useful body.');
    expect(result.markdown).not.toContain('Navigation');
    expect(result.markdown).not.toContain('Footer');
    expect(network).not.toHaveBeenCalled();
  });

  test('never leaks its internal base when no stable canonical exists', async () => {
    const result = await renderer.render(input({
      canonicalUrl: undefined,
      html: '<html><body><article><a href="/relative">Relative</a></article></body></html>',
    }));
    expect(result.status).toBe('rendered');
    expect(result.markdown).toContain('](/relative)');
    expect(result.markdown).not.toContain('astro-aeo.invalid');
  });

  test.each(['useAsync', 'fetch', 'url', 'markdown', 'separateMarkdown', 'debug'])(
    'rejects the caller-controlled %s option',
    async (key) => {
      const result = await renderer.render(input({ options: { [key]: true } }));
      expect(result).toMatchObject({
        status: 'continue',
        diagnostics: [{ code: 'defuddle-invalid-options', severity: 'warning' }],
      });
    },
  );
});
