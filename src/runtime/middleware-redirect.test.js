import { describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({ markdown: { negotiation: 'redirect' } }),
      site: {
        siteUrl: 'https://example.test',
        base: '/docs',
        trailingSlash: 'ignore',
      },
      staticPaths: ['/about'],
      internalRequestToken: 'opaque-test-token',
      standaloneSources: {},
    },
    RUNTIME_CATALOGS: [],
  };
});

const { onRequest } = await import('./middleware.js');

function context(pathname, accept = 'text/markdown') {
  const url = new URL(pathname, 'https://example.test');
  return {
    request: new Request(url, { headers: { accept } }),
    url,
    locals: {},
    isPrerendered: false,
    rewrite: vi.fn(),
  };
}

describe('redirect negotiation', () => {
  test('renders first, then redirects with base, query, cache, and Vary intact', async () => {
    const ctx = context('/docs/about?view=full');
    const next = vi.fn(async () => new Response('<html><main>About</main></html>', {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'private, max-age=30',
        vary: 'Origin',
        'x-app-header': 'preserved',
      },
    }));
    const response = await onRequest(ctx, next);
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/docs/about.md?view=full');
    expect(response.headers.get('cache-control')).toBe('private, max-age=30');
    expect(response.headers.get('vary')).toBe('Origin, Accept');
    expect(response.headers.get('x-app-header')).toBe('preserved');
  });

  test('does not redirect missing, error, or non-HTML responses', async () => {
    for (const response of [
      new Response('<html><main>Missing</main></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
      Response.json({ kind: 'api' }),
    ]) {
      const ctx = context('/docs/about');
      expect(await onRequest(ctx, vi.fn(async () => response))).toBe(response);
    }
  });

  test('HTML selection receives an alternate link and a cache-safe Vary header', async () => {
    const ctx = context('/docs/about', 'text/html, text/markdown;q=0.5');
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response('<html><head></head><body><main>About</main></body></html>', {
        headers: { 'content-type': 'text/html', vary: 'Origin' },
      })),
    );
    expect(response.headers.get('vary')).toBe('Origin, Accept');
    expect(await response.text()).toContain(
      '<link rel="alternate" type="text/markdown" href="/docs/about.md">',
    );
  });

  test('marker removal clears stale representation headers on an opted-out page', async () => {
    const ctx = context('/docs/about');
    const marker = '<script data-astro-aeo-marker type="application/vnd.astro-aeo+json">{}</script>';
    const html = `<html><head><meta name="aeo" content="no-dotmd"></head><body>${marker}<main>About</main></body></html>`;
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response(html, {
        headers: {
          'content-type': 'text/html',
          'content-length': '9999',
          'content-encoding': 'gzip',
          'content-range': 'bytes 0-10/11',
          etag: '"stale"',
          vary: 'Origin',
        },
      })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('vary')).toBe('Origin, Accept');
    for (const name of ['content-length', 'content-encoding', 'content-range', 'etag']) {
      expect(response.headers.get(name), name).toBeNull();
    }
    expect(await response.text()).not.toContain('astro-aeo-marker');
  });

  test('escapes decoded path bytes before injecting an alternate-link href', async () => {
    const ctx = context('/docs/%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E', 'text/html');
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response('<html><head></head><body><main>Safe</main></body></html>', {
        headers: { 'content-type': 'text/html' },
      })),
    );
    const body = await response.text();
    expect(body).toContain('href="/docs/&quot;&gt;&lt;img');
    expect(body).not.toContain('<img src=x onerror=alert(1)>');
  });

  test.each([
    ['?from=old', '/docs/old.md?from=old'],
    ['/docs/about.md?from=old', '/docs/about.md?from=old'],
  ])('rewrites direct-request redirect target %s exactly once', async (location, expected) => {
    const ctx = context('/docs/old.md');
    ctx.rewrite = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location },
    }));
    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(expected);
  });
});
