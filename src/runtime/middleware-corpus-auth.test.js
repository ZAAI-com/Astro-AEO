import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig(),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: ['/protected', '/public'],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');
const FETCH_STATE = Symbol.for('astro.fetchState');

function disposableContext({ request, url, locals = {}, render }) {
  const rewrites = vi.fn();
  const responses = [];
  const instances = [];
  class FakeState {
    constructor(pipeline, stateRequest, options = {}) {
      this.pipeline = pipeline;
      this.request = stateRequest;
      this.renderOptions = options;
      this.locals = options.locals ?? {};
      this.cookies = { request: stateRequest };
      instances.push(this);
    }
    async rewrite(target) {
      rewrites(target);
      const innerUrl = new URL(target.url);
      const response = await onRequest(
        {
          request: target,
          url: innerUrl,
          locals: this.locals,
          isPrerendered: false,
          rewrite: this.rewrite.bind(this),
          [FETCH_STATE]: this,
        },
        vi.fn(() => this.pipeline.render(target, this)),
      );
      responses.push(response);
      return response;
    }
  }
  const pipeline = { manifest: {}, render };
  const outer = new FakeState(pipeline, request, { locals });
  return {
    context: {
      request,
      url,
      locals,
      isPrerendered: false,
      rewrite: outer.rewrite.bind(outer),
      [FETCH_STATE]: outer,
    },
    instances,
    responses,
    rewrites,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('runtime corpus subrequests', () => {
  test('serializes rewrites without making a forged-Host network request', async () => {
    const url = new URL('https://forged-host.invalid/llms-full.txt');
    const request = new Request(url, {
      headers: {
        accept: 'text/markdown',
        'accept-encoding': 'gzip',
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'if-none-match': '"markdown-tag"',
        range: 'bytes=0-99',
      },
    });
    let active = 0;
    let peak = 0;
    const locals = {
      runtime: { platform: 'test' },
      callerUser: 'must-not-enter-corpus',
    };
    const harness = disposableContext({
      request,
      url,
      locals,
      render: async (target, state) => {
        active++;
        peak = Math.max(peak, active);
        expect(target).toBeInstanceOf(Request);
        expect(new URL(target.url).origin).toBe('https://forged-host.invalid');
        expect(target.method).toBe('GET');
        expect(target.headers.get('authorization')).toBeNull();
        expect(target.headers.get('cookie')).toBeNull();
        expect(target.headers.get('accept')).toBe('text/html, application/xhtml+xml');
        expect(target.headers.get('accept-encoding')).toBe('identity');
        expect(target.headers.get('if-none-match')).toBeNull();
        expect(target.headers.get('range')).toBeNull();
        expect(target.headers.get('x-astro-aeo-internal')).toBeNull();
        expect(target.headers.get('x-astro-aeo-internal-purpose')).toBe('corpus');
        expect(target.headers.get('cache-control')).toBe('no-store');
        expect(target.cache).toBe('no-store');
        expect(state.locals.runtime).toBeUndefined();
        expect(state.locals.callerUser).toBeUndefined();
        expect(state.locals.previousPageUser).toBeUndefined();
        state.locals.previousPageUser = 'must-not-reach-the-next-page';
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        const innerUrl = new URL(target.url);
        const protectedPage = innerUrl.pathname === '/protected/';
        return protectedPage
          ? new Response('Forbidden', {
              status: 403,
              headers: { 'content-type': 'text/plain' },
            })
          : new Response(
              '<html><head><title>Public</title></head><body><main><h1>Public</h1></main></body></html>',
              {
                headers: {
                  'cache-control': 'public, max-age=3600',
                  'content-type': 'text/html',
                  vary: 'Accept-Encoding',
                  'x-astro-aeo-internal': 'reflected-value',
                  'x-astro-aeo-internal-purpose': 'corpus',
                },
              },
            );
      },
    });
    const networkFetch = vi.fn();
    vi.stubGlobal('fetch', networkFetch);

    const response = await onRequest(
      harness.context,
      vi.fn(),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('# Public');
    expect(body).not.toContain('secret');
    expect(harness.rewrites).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(locals).toEqual({
      runtime: { platform: 'test' },
      callerUser: 'must-not-enter-corpus',
    });
    const publicSource = harness.responses.find((candidate) => candidate.status === 200);
    expect(publicSource).toBeDefined();
    expect(publicSource.headers.get('content-type')).toBe('text/html');
    expect(publicSource.headers.get('cache-control')).toBe('private, no-store');
    expect(publicSource.headers.get('vary')).toBe(
      'Accept-Encoding, x-astro-aeo-internal-purpose',
    );
    expect(publicSource.headers.get('x-astro-aeo-internal')).toBeNull();
    expect(publicSource.headers.get('x-astro-aeo-internal-purpose')).toBeNull();
  });

  test('does not trust externally supplied internal-looking headers', async () => {
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
          'x-astro-aeo-internal': 'opaque-test-token',
          'x-astro-aeo-internal-purpose': 'corpus',
        },
      })),
    );

    expect(await response.text()).not.toContain('astro-aeo-marker');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  test('keeps caller state detached when an opaque corpus cancellation yields forever', async () => {
    const url = new URL('https://example.test/llms-full.txt');
    const request = new Request(url);
    const locals = { callerUser: 'private' };
    let cancelled = false;
    let observedCaller;
    let markCancellation;
    const cancellationObserved = new Promise((resolve) => { markCancellation = resolve; });
    const harness = disposableContext({
      request,
      url,
      locals,
      render: async (target, state) => {
        const innerUrl = new URL(target.url);
        return innerUrl.pathname === '/protected/'
          ? new Response(new ReadableStream({
              async cancel() {
                cancelled = true;
                await Promise.resolve();
                observedCaller = state.locals.callerUser;
                markCancellation();
                return new Promise(() => {});
              },
            }), { headers: { 'content-type': 'text/event-stream' } })
          : new Response(
              '<html><head><title>Public</title></head><body><main><h1>Public</h1></main></body></html>',
              { headers: { 'content-type': 'text/html' } },
            );
      },
    });

    const response = await Promise.race([
      onRequest(harness.context, vi.fn()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cancel stalled corpus')), 1000)),
    ]);
    await cancellationObserved;

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('# Public');
    expect(cancelled).toBe(true);
    expect(observedCaller).toBeUndefined();
    expect(harness.rewrites).toHaveBeenCalledTimes(2);
    expect(locals).toEqual({ callerUser: 'private' });
  });

  test('bypasses source caches while preserving the final direct cache policy', async () => {
    const url = new URL('https://example.test/public.md');
    const request = new Request(url);
    const locals = {};
    const rewrite = vi.fn(async (target) => {
      expect(target.headers.get('cache-control')).toBe('no-store');
      expect(target.cache).toBe('no-store');
      const innerUrl = new URL(target.url);
      return onRequest(
        { request: target, url: innerUrl, locals, isPrerendered: false, rewrite: vi.fn() },
        vi.fn(async () => new Response(
          '<html><head><title>Page</title></head><body><main><h1>Page</h1></main></body></html>',
          { headers: { 'cache-control': 'public, max-age=3600', 'content-type': 'text/html' } },
        )),
      );
    });
    const response = await onRequest(
      { request, url, locals, isPrerendered: false, rewrite },
      vi.fn(),
    );

    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('x-astro-aeo-internal')).toBeNull();
    expect(response.headers.get('x-astro-aeo-internal-purpose')).toBeNull();
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(await response.text()).toContain('# Page');
  });

  test('uses a fresh Astro request state for every corpus page', async () => {
    const fetchStateSymbol = Symbol.for('astro.fetchState');
    const instances = [];
    const pipeline = { manifest: {} };
    class FakeCookies {
      constructor(request) { this.request = request; }
    }
    class FakeState {
      constructor(statePipeline, request, options = {}) {
        this.pipeline = statePipeline;
        this.request = request;
        this.renderOptions = options;
        this.locals = options.locals ?? {};
        this.cookies = new FakeCookies(request);
        instances.push(this);
      }
      async rewrite(request) {
        expect(this.locals.previousPage).toBeUndefined();
        this.locals.previousPage = new URL(request.url).pathname;
        const url = new URL(request.url);
        return onRequest(
          {
            request,
            url,
            locals: this.locals,
            isPrerendered: false,
            rewrite: this.rewrite.bind(this),
            [fetchStateSymbol]: this,
          },
          vi.fn(async () => new Response(
            `<html><head><title>${url.pathname}</title></head><body><main><h1>${url.pathname}</h1></main></body></html>`,
            { headers: { 'content-type': 'text/html' } },
          )),
        );
      }
    }

    const url = new URL('https://example.test/llms-full.txt');
    const outer = new FakeState(pipeline, new Request(url), {
      locals: { callerUser: 'private' },
    });
    const context = {
      request: outer.request,
      url,
      locals: outer.locals,
      isPrerendered: false,
      rewrite: vi.fn(),
      [fetchStateSymbol]: outer,
    };
    const response = await onRequest(context, vi.fn());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('# /public/');
    expect(context.rewrite).not.toHaveBeenCalled();
    expect(instances).toHaveLength(3);
    expect(instances[1]).not.toBe(instances[2]);
    expect(outer.locals).toEqual({ callerUser: 'private' });
  });

  test.each([
    ['Astro 5', Symbol.for('context.routes')],
    ['Astro 6.0-6.2', Symbol.for('astro.pipeline')],
  ])('fails closed for %s before caller-bound state can render', async (_version, pipelineSymbol) => {
    const url = new URL('https://example.test/llms-full.txt');
    const request = new Request(url, {
      headers: {
        authorization: 'Bearer caller-secret',
        cookie: 'session=caller-secret',
      },
    });
    const readCookie = vi.fn(() => ({ value: 'caller-secret' }));
    let clientAddressReads = 0;
    const context = {
      request,
      url,
      locals: { callerUser: 'private' },
      cookies: { get: readCookie },
      session: { get: vi.fn(async () => 'caller-secret') },
      isPrerendered: false,
      rewrite: vi.fn(),
      [pipelineSymbol]: { manifest: {} },
    };
    Object.defineProperty(context, 'clientAddress', {
      configurable: true,
      get() {
        clientAddressReads++;
        return '203.0.113.42';
      },
    });
    const next = vi.fn();

    const response = await onRequest(context, next);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toContain('require Astro 6.3 or newer');
    expect(next).not.toHaveBeenCalled();
    expect(context.rewrite).not.toHaveBeenCalled();
    expect(readCookie).not.toHaveBeenCalled();
    expect(context.session.get).not.toHaveBeenCalled();
    expect(clientAddressReads).toBe(0);
    expect(context.locals).toEqual({ callerUser: 'private' });
  });

  test('keeps the isolation 503 for HEAD and matching conditional requests', async () => {
    const url = new URL('https://example.test/llms-full.txt');
    const first = await onRequest({
      request: new Request(url),
      url,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, vi.fn());
    const response = await onRequest({
      request: new Request(url, {
        method: 'HEAD',
        headers: { 'if-none-match': first.headers.get('etag') },
      }),
      url,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, vi.fn());

    expect(first.status).toBe(503);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});
