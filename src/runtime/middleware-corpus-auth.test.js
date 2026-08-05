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
    RUNTIME_CATALOGS: [],
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
});
