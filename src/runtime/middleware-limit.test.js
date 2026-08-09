import { describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({ corpus: { runtime: { maxPages: 50 } } }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: Array.from({ length: 51 }, (_, index) => `/page-${index}`),
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');

function context(headers = {}) {
  const url = new URL('https://example.test/llms.txt');
  class FakeState {
    constructor() { this.pipeline = {}; }
    async rewrite() { throw new Error('limit must be checked before rendering'); }
  }
  const state = new FakeState();
  return {
    request: new Request(url, { headers }),
    url,
    locals: {},
    isPrerendered: false,
    rewrite: vi.fn(),
    [Symbol.for('astro.fetchState')]: state,
  };
}

describe('request-level corpus loop and limit guards', () => {
  test('returns 503 and no-store before rendering route 51', async () => {
    const ctx = context();
    const next = vi.fn();
    const response = await onRequest(ctx, next);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('51 pages');
    expect(next).not.toHaveBeenCalled();
    expect(ctx.rewrite).not.toHaveBeenCalled();
  });

  test('a matching conditional tag cannot replace the required 503 status', async () => {
    const first = await onRequest(context(), vi.fn());
    const response = await onRequest(
      context({ 'if-none-match': first.headers.get('etag') }),
      vi.fn(),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('a caller cannot forge the in-process rewrite sentinel', async () => {
    const ctx = context({ 'x-astro-aeo-internal': 'opaque-test-token' });
    const next = vi.fn();
    const response = await onRequest(ctx, next);
    expect(response.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.locals.astroAeoCollect).toBeUndefined();
  });
});
