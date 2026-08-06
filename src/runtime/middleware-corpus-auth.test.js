import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig(),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: ['/protected', '/public'],
      internalRequestToken: 'opaque-test-token',
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');

afterEach(() => vi.unstubAllGlobals());

describe('runtime corpus subrequests', () => {
  test('strip caller credentials from both rewrites and later self-fetches', async () => {
    const url = new URL('https://example.test/llms-full.txt');
    const request = new Request(url, {
      headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
    });
    const rewrite = vi.fn(async (target) => {
      expect(target).toBeInstanceOf(Request);
      expect(target.headers.get('authorization')).toBeNull();
      expect(target.headers.get('cookie')).toBeNull();
      expect(target.headers.get('x-astro-aeo-internal')).toBe('opaque-test-token');
      expect(target.headers.get('x-astro-aeo-internal-purpose')).toBe('corpus');
      expect(target.headers.get('cache-control')).toBe('no-store');
      expect(target.cache).toBe('no-store');
      return new Response('Forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    });
    const selfFetch = vi.fn(async (_target, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('cookie')).toBeNull();
      expect(headers.get('x-astro-aeo-internal')).toBe('opaque-test-token');
      expect(headers.get('x-astro-aeo-internal-purpose')).toBe('corpus');
      expect(headers.get('cache-control')).toBe('no-store');
      expect(init?.cache).toBe('no-store');
      const html = '<html><head><title>Public</title></head><body><main><h1>Public</h1></main></body></html>';
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', selfFetch);

    const response = await onRequest(
      { request, url, locals: {}, isPrerendered: false, rewrite },
      vi.fn(),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('# Public');
    expect(body).not.toContain('secret');
    expect(rewrite).toHaveBeenCalledOnce();
    expect(selfFetch).toHaveBeenCalledOnce();
  });

  test('force marker-bearing corpus responses out of shared caches', async () => {
    const url = new URL('https://example.test/public/');
    const request = new Request(url, {
      headers: {
        'x-astro-aeo-internal': 'opaque-test-token',
        'x-astro-aeo-internal-purpose': 'corpus',
      },
    });
    const marker = '<script data-astro-aeo-marker>authored source</script>';
    const response = await onRequest(
      { request, url, locals: {}, isPrerendered: false },
      vi.fn(async () => new Response(marker, {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'text/html',
          vary: 'Accept-Encoding',
        },
      })),
    );

    expect(await response.text()).toBe(marker);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe(
      'Accept-Encoding, x-astro-aeo-internal-purpose',
    );
  });

  test('leave direct Markdown source cache policy unchanged', async () => {
    const url = new URL('https://example.test/public/');
    const request = new Request(url, {
      headers: { 'x-astro-aeo-internal': 'opaque-test-token' },
    });
    const response = await onRequest(
      { request, url, locals: {}, isPrerendered: false },
      vi.fn(async () => new Response('page', {
        headers: { 'cache-control': 'public, max-age=3600' },
      })),
    );

    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });
});
