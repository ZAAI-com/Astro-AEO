import { describe, expect, test } from 'vitest';
import { DEFAULT_EXTRACTION, extractHtml } from './extract.js';
import { AeoConfigError } from './lib/errors.js';

describe('astro-aeo/extract', () => {
  test('uses the shared defaults and exposes diagnostics', async () => {
    const result = await extractHtml(
      '<html><body><nav>Chrome</nav><main><h1>Hello</h1><a href="/about">About</a></main></body></html>',
      undefined,
      { baseUrl: 'https://example.com/' },
    );
    expect(DEFAULT_EXTRACTION.selectors).toEqual(['article', 'main']);
    expect(result.markdown).toContain('# Hello');
    expect(result.markdown).toContain('(https://example.com/about)');
    expect(result.markdown).not.toContain('Chrome');
    expect(result.diagnostics).toMatchObject({ strategy: 'main', selectedNodes: 1 });
  });

  test.each(['selectors', 'removeSelectors', 'keepSelectors'])(
    'requires %s to be an array',
    async (key) => {
      await expect(extractHtml('<main>Body</main>', { [key]: 'main' })).rejects.toBeInstanceOf(
        AeoConfigError,
      );
    },
  );

  test('rejects invalid selector entries with AeoConfigError', async () => {
    await expect(extractHtml('<main>Body</main>', { selectors: ['main['] })).rejects.toBeInstanceOf(
      AeoConfigError,
    );
    await expect(extractHtml('<main>Body</main>', { removeSelectors: [42] })).rejects.toBeInstanceOf(
      AeoConfigError,
    );
  });

  test('accepts empty selector arrays', async () => {
    const result = await extractHtml('<main><h1>Body</h1></main>', {
      selectors: [],
      removeSelectors: [],
      keepSelectors: [],
    });
    expect(result.markdown).toBe('# Body');
  });
});
