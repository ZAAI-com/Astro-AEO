import { beforeEach, describe, expect, test, vi } from 'vitest';

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
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const { resolveConfig } = await import('../config.js');

beforeEach(() => {
  RUNTIME.config = resolveConfig({ markdown: { negotiation: 'redirect' } });
});

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
        'content-digest': 'sha-256=:stale:',
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
    expect(response.headers.get('content-digest')).toBeNull();
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

  test.each([204, 205])('passes negotiated bodyless status %s through unchanged', async (status) => {
    const ctx = context('/docs/about');
    const source = new Response(null, {
      status,
      headers: { 'content-type': 'text/html', 'x-source': String(status) },
    });
    const response = await onRequest(ctx, vi.fn(async () => source));

    expect(response).toBe(source);
    expect(await response.text()).toBe('');
  });

  test.each([204, 205])('forwards direct Markdown bodyless status %s', async (status) => {
    const ctx = context('/docs/empty.md');
    ctx.rewrite = vi.fn(async () => new Response(null, {
      status,
      headers: { 'content-type': 'text/html', 'x-source': String(status) },
    }));
    const response = await onRequest(ctx, vi.fn());

    expect(response.status).toBe(status);
    expect(response.headers.get('x-source')).toBe(String(status));
    expect(await response.text()).toBe('');
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

  test('cancels the unread source branch when generated HTML replaces it', async () => {
    const ctx = context('/docs/about', 'text/html');
    const bytes = new TextEncoder().encode(
      '<html><head></head><body><main>About</main></body></html>',
    );
    const source = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }), { headers: { 'content-type': 'text/html' } });

    const response = await onRequest(ctx, vi.fn(async () => source));
    expect(await response.text()).toContain('rel="alternate"');
    expect(source.bodyUsed).toBe(true);
  });

  test('keeps byte metadata when negotiation changes only Vary', async () => {
    RUNTIME.config = resolveConfig({
      markdown: { negotiation: 'redirect' },
      schema: { autoInject: false },
    });
    const ctx = context('/docs/about', 'text/html, text/markdown;q=0.5');
    const html = '<html><head><link rel="alternate" type="text/markdown" href="/docs/about.md"></head><body><main>About</main></body></html>';
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(new TextEncoder().encode(html).length),
          'content-digest': 'sha-256=:current:',
          etag: '"current"',
        },
      })),
    );

    expect(response.headers.get('vary')).toBe('Accept');
    expect(response.headers.get('content-length')).toBe(String(html.length));
    expect(response.headers.get('content-digest')).toBe('sha-256=:current:');
    expect(response.headers.get('etag')).toBe('"current"');
    expect(await response.text()).toBe(html);
  });

  test('forwards legacy-encoded HTML bytes without transforming them', async () => {
    const ctx = context('/docs/plain', 'text/html, text/markdown;q=0.5');
    const bytes = new Uint8Array([0x70, 0xe9]);
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response(bytes, {
        headers: {
          'content-type': 'text/html; charset=iso-8859-1',
          'content-length': String(bytes.length),
          etag: '"source-bytes"',
        },
      })),
    );

    expect(response.headers.get('vary')).toBeNull();
    expect(response.headers.get('content-length')).toBe('2');
    expect(response.headers.get('etag')).toBe('"source-bytes"');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes]);
  });

  test('marker removal clears stale representation headers and rehashes an opted-out page', async () => {
    const ctx = context('/docs/about');
    const marker = '<script data-astro-aeo-marker type="application/vnd.astro-aeo+json">{}</script>';
    const html = `<html><head><meta name="aeo" content="no-dotmd"></head><body>${marker}<main>About</main></body></html>`;
    const response = await onRequest(
      ctx,
      vi.fn(async () => new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '9999',
          'content-encoding': 'identity',
          'content-digest': 'sha-256=:stale:',
          'content-range': 'bytes 0-10/11',
          etag: '"stale"',
          vary: 'Origin',
        },
      })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('vary')).toBe('Origin, Accept');
    for (const name of ['content-length', 'content-encoding', 'content-digest', 'content-range']) {
      expect(response.headers.get(name), name).toBeNull();
    }
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get('etag')).not.toBe('"stale"');
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
    expect(body).toContain('href="/docs/%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E.md"');
    expect(body).not.toContain('<img src=x onerror=alert(1)>');
  });

  test('keeps encoded literal percents valid in links, redirects, and source rewrites', async () => {
    const html = '<html><head></head><body><main><h1>Sale</h1></main></body></html>';

    const htmlContext = context('/docs/sale-100%25', 'text/html');
    const htmlResponse = await onRequest(
      htmlContext,
      vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })),
    );
    expect(await htmlResponse.text()).toContain('href="/docs/sale-100%25.md"');

    const redirectContext = context('/docs/sale-100%25', 'text/markdown');
    const redirect = await onRequest(
      redirectContext,
      vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })),
    );
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get('location')).toBe('/docs/sale-100%25.md');
    expect(redirect.headers.get('link')).toContain('/docs/sale-100%25/');

    const directContext = context('/docs/sale-100%25.md');
    directContext.rewrite = vi.fn(async (target) => {
      expect(new URL(target.url).pathname).toBe('/docs/sale-100%25/');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    });
    const direct = await onRequest(directContext, vi.fn());
    expect(direct.status).toBe(200);
    expect(direct.headers.get('link')).toContain('/docs/sale-100%25/');
    expect(await direct.text()).toContain('# Sale');
  });

  test('recognizes HTML media types exactly and case-insensitively', async () => {
    const markdownContext = context('/docs/about.md');
    markdownContext.rewrite = vi.fn(async () =>
      new Response('<html><main><h1>About</h1></main></html>', {
        headers: { 'content-type': 'Text/HTML; Charset=UTF-8' },
      }),
    );
    const markdown = await onRequest(markdownContext, vi.fn());
    expect(markdown.headers.get('content-type')).toContain('text/markdown');

    const nonHtmlContext = context('/docs/about');
    const source = new Response('not html', {
      headers: { 'content-type': 'application/nothtml' },
    });
    expect(await onRequest(nonHtmlContext, vi.fn(async () => source))).toBe(source);
  });

  test.each([
    ['gzip', 200],
    ['identity', 206],
  ])('passes through an untransformable HTML response (%s, %s)', async (encoding, status) => {
    const ctx = context('/docs/about');
    const source = new Response('encoded or partial', {
      status,
      headers: {
        'content-type': 'text/html',
        ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      },
    });

    expect(await onRequest(ctx, vi.fn(async () => source))).toBe(source);
  });

  test('does not open the authored-source channel for an encoded ordinary response', async () => {
    const ctx = context('/docs/about', 'text/markdown');
    const next = vi.fn(async () => {
      const marker = ctx.locals.astroAeoCollect ? 'PRIVATE-AUTHORED-SOURCE' : 'PUBLIC-HTML';
      return new Response(marker, {
        headers: {
          'content-encoding': 'gzip',
          'content-type': 'text/html',
        },
      });
    });

    const response = await onRequest(ctx, next);
    expect(await response.text()).toBe('PUBLIC-HTML');
    expect(ctx.locals.astroAeoCollect).toBeUndefined();
    expect(ctx.rewrite).not.toHaveBeenCalled();
  });

  test('does not emit a partial status for a direct generated Markdown request', async () => {
    const ctx = context('/docs/about.md');
    ctx.rewrite = vi.fn(async () => new Response('partial html', {
      status: 206,
      headers: {
        'content-type': 'text/html',
        'content-range': 'bytes 0-11/100',
      },
    }));

    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(404);
    expect(response.headers.get('content-range')).toBeNull();
    expect(await response.text()).toBe('');
  });

  test('does not forward a non-HTML partial response from a direct Markdown URL', async () => {
    const ctx = context('/docs/about.md');
    ctx.rewrite = vi.fn(async () => new Response('partial api', {
      status: 206,
      headers: {
        'content-type': 'application/json',
        'content-range': 'bytes 0-10/100',
      },
    }));

    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(404);
    expect(response.headers.get('content-range')).toBeNull();
    expect(await response.text()).toBe('');
  });

  test('skips and cancels a legacy-encoded direct source instead of corrupting it', async () => {
    const ctx = context('/docs/about.md');
    const source = new Response(new Uint8Array([0x70, 0xe9]), {
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
    });
    ctx.rewrite = vi.fn(async () => source);

    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(source.bodyUsed).toBe(true);
  });

  test('forwards an opaque streaming direct source without buffering it', async () => {
    const ctx = context('/docs/events.md');
    let cancelled = false;
    const source = new Response(new ReadableStream({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    ctx.rewrite = vi.fn(async () => source);

    const response = await Promise.race([
      onRequest(ctx, vi.fn()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('stream was buffered')), 100)),
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    await Promise.race([
      response.body.cancel(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cancel was awaited')), 100)),
    ]);
    expect(cancelled).toBe(true);
  });

  test('cancels an opaque collected render and falls back to the safe probe', async () => {
    const ctx = context('/docs/about.md');
    let cancelled = false;
    ctx.rewrite = vi.fn(async () => {
      if (ctx.rewrite.mock.calls.length === 1) {
        return new Response('<html><main><h1>Safe</h1></main></html>', {
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(new ReadableStream({
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });

    const response = await Promise.race([
      onRequest(ctx, vi.fn()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('stream was buffered')), 100)),
    ]);
    expect(ctx.rewrite).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('# Safe');
  });

  test('sanitizes representation headers before loading a direct Markdown source', async () => {
    const ctx = context('/docs/about.md');
    ctx.request = new Request(ctx.url, {
      headers: {
        accept: 'text/markdown',
        'accept-charset': 'iso-8859-1',
        'accept-encoding': 'gzip',
        'accept-language': 'de',
        'if-none-match': '"markdown-tag"',
        range: 'bytes=0-20',
      },
    });
    ctx.rewrite = vi.fn(async (target) => {
      expect(target.method).toBe('GET');
      expect(target.headers.get('accept')).toBe('text/html, application/xhtml+xml');
      expect(target.headers.get('accept-charset')).toBeNull();
      expect(target.headers.get('accept-encoding')).toBe('identity');
      expect(target.headers.get('accept-language')).toBeNull();
      expect(target.headers.get('if-none-match')).toBeNull();
      expect(target.headers.get('range')).toBeNull();
      return new Response('<html><main><h1>About</h1></main></html>', {
        headers: {
          'content-type': 'text/html',
          'x-astro-aeo-internal': 'opaque-test-token',
          'x-astro-aeo-internal-purpose': 'direct',
        },
      });
    });

    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('x-astro-aeo-internal')).toBeNull();
    expect(response.headers.get('x-astro-aeo-internal-purpose')).toBeNull();
  });

  test('preserves an application redirect body and its byte metadata', async () => {
    const ctx = context('/docs/old.md');
    const body = 'Moved to the canonical page.';
    ctx.rewrite = vi.fn(async () => new Response(body, {
      status: 302,
      headers: {
        'content-digest': 'sha-256=:body-digest:',
        'content-length': String(new TextEncoder().encode(body).length),
        'content-type': 'text/plain',
        location: '/docs/about?from=old',
      },
    }));

    const response = await onRequest(ctx, vi.fn());
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/docs/about.md?from=old');
    expect(response.headers.get('content-length')).toBe(String(body.length));
    expect(response.headers.get('content-digest')).toBe('sha-256=:body-digest:');
    expect(await response.text()).toBe(body);
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

  test.each([
    ['/login?next=/docs/old', '/login?next=/docs/old'],
    [
      'https://example.test/login?next=/docs/old#form',
      'https://example.test/login?next=/docs/old#form',
    ],
  ])('preserves a same-origin redirect outside the configured base: %s', async (location, expected) => {
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
