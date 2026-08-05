import { describe, expect, test } from 'vitest';
import { DEFAULT_EXTRACTION, extractHtml } from './extract.js';

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
});
