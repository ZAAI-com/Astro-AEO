import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  const { createLocaleSnapshot } = await import('../core/locale.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({
        corpus: {
          small: { enabled: true, maxTokens: 1_000 },
          chunks: { enabled: true, maxTokensPerFile: 1_000 },
          manifest: { enabled: true },
        },
        schema: { corpus: { enabled: true } },
        i18n: { indexes: 'both' },
      }),
      site: {
        siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore',
        i18n: createLocaleSnapshot({
          locales: ['en', 'fr'], defaultLocale: 'en', routing: { prefixDefaultLocale: true },
        }, 'https://example.test'),
      },
      staticPaths: ['/en/a-healthy', '/en/z-failing', '/fr/guide'],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_DYNAMIC_ROUTE_SOURCE: null,
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
    RUNTIME_CORPUS_TOKENIZER_LOADER: undefined,
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const FETCH_STATE = Symbol.for('astro.fetchState');
const originalConfig = RUNTIME.config;

afterEach(() => {
  RUNTIME.config = originalConfig;
  RUNTIME.command = 'preview';
  delete RUNTIME.buildOwnsCorpora;
  delete RUNTIME.dynamicPagesUnreachable;
});

const html = (pathname) => `<!doctype html><html lang="${pathname.startsWith('/fr') ? 'fr' : 'en'}"><head><title>${pathname}</title></head><body><main><h1>${pathname}</h1><p>Complete public content.</p></main></body></html>`;
const healthy = (pathname) => new Response(html(pathname), { headers: { 'content-type': 'text/html' } });

function requestCorpus(pathname, fail = null, init = {}, setup = null) {
  const url = new URL(pathname, RUNTIME.site.siteUrl);
  const request = new Request(url, init);
  const rendered = [];
  class FakeState {
    constructor(pipeline, stateRequest, options = {}) {
      this.pipeline = pipeline;
      this.request = stateRequest;
      this.renderOptions = options;
      this.locals = options.locals ?? {};
      this.cookies = { request: stateRequest };
    }
    async rewrite(target) {
      const innerUrl = new URL(target.url);
      rendered.push(innerUrl.pathname);
      return onRequest({
        request: target, url: innerUrl, locals: this.locals,
        isPrerendered: false, rewrite: this.rewrite.bind(this), [FETCH_STATE]: this,
      }, async () => innerUrl.pathname.includes('z-failing') && fail
        ? fail(target) : healthy(innerUrl.pathname));
    }
  }
  const outer = new FakeState({ manifest: {} }, request, { locals: { callerSecret: 'PRIVATE' } });
  setup?.(outer, FakeState);
  const next = vi.fn(async () => new Response('PROJECT FALLTHROUGH', { status: 404 }));
  const response = onRequest({
    request, url, locals: outer.locals, isPrerendered: false,
    rewrite: outer.rewrite.bind(outer), [FETCH_STATE]: outer,
  }, next);
  return { response, rendered, next, outer };
}

const families = [
  '/llms.txt', '/llms-full.txt', '/llms-small.txt',
  '/en/llms.txt', '/en/llms-full.txt', '/en/llms-small.txt',
  '/fr/llms-full.txt', '/llms-en.txt', '/llms-full-en.txt', '/llms-small-en.txt',
  '/llms/manifest.json', '/en/llms/pages-0001.txt',
  '/schema/graph.jsonld', '/schema/schema-map.xml',
];

const failingResponse = (status = 200, contentType = 'text/html', extra = {}, body = 'SECRET UPSTREAM BODY') =>
  new Response(body, { status, headers: {
    'content-type': contentType, 'set-cookie': 'SECRET_COOKIE',
    'cache-control': 'public, max-age=3600', 'x-upstream-secret': 'SECRET_HEADER',
    ...extra,
  } });

const failures = [
  ['thrown rewrite', () => { throw new Error('SECRET REWRITE'); }],
  ['null rewrite', () => null],
  ['HTML 500', () => failingResponse(500)],
  ['non-HTML 503', () => failingResponse(503, 'application/json')],
  ['HTML 206', () => failingResponse(206)],
  ['encoded HTML', () => failingResponse(200, 'text/html', { 'content-encoding': 'gzip' })],
  ['unsupported charset', () => failingResponse(200, 'text/html; charset=windows-1252')],
  ['malformed charset', () => failingResponse(200, 'text/html; charset=')],
  ['malformed duplicate charset', () => failingResponse(200, 'text/html; charset=utf-8; charset=')],
  ['malformed quoted charset', () => failingResponse(200, 'text/html; charset="utf-8"junk')],
  ['unreadable stream', () => failingResponse(200, 'text/html', {}, new ReadableStream({
    start(controller) { controller.error(new Error('SECRET STREAM FAILURE')); },
  }))],
  ['missing HTML body', () => failingResponse(200, 'text/html', {}, null)],
  ['blank HTML', () => failingResponse(200, 'text/html', {}, ' \n\t')],
  ['upstream 304', () => failingResponse(304, 'text/html', { etag: '"source-etag"' }, null)],
];

describe('production aggregate HTTP completeness', () => {
  test.each(families)('serves the complete healthy family %s', async (pathname) => {
    const harness = requestCorpus(pathname);
    const response = await harness.response;
    expect(response.status).toBe(200);
    expect(await response.text()).not.toBe('');
    expect(harness.next).not.toHaveBeenCalled();
  });

  describe.each(families)('%s', (pathname) => {
    test.each(failures)('returns sanitized 503 for %s, never a partial artifact', async (_label, fail) => {
      const harness = requestCorpus(pathname, fail);
      const response = await harness.response;
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('x-upstream-secret')).toBeNull();
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(await response.text()).toBe(pathname.startsWith('/schema/')
        ? 'astro-aeo: the semantic corpus is temporarily unavailable.\n'
        : 'astro-aeo: the corpus is temporarily unavailable.\n');
      expect(harness.rendered.slice(0, 2)).toEqual(['/en/a-healthy/', '/en/z-failing/']);
      expect(harness.next).not.toHaveBeenCalled();
      expect(harness.outer.locals).toEqual({ callerSecret: 'PRIVATE' });
    });
  });

  test.each(['/llms-full.txt', '/llms/manifest.json', '/schema/graph.jsonld', '/schema/schema-map.xml'])(
    'keeps HEAD and conditional collection failures at 503 for %s', async (pathname) => {
      const healthyResponse = await requestCorpus(pathname).response;
      const failedResponse = await requestCorpus(pathname, () => failingResponse(500)).response;
      for (const method of ['GET', 'HEAD']) {
        for (const etag of ['*', healthyResponse.headers.get('etag'), failedResponse.headers.get('etag')]) {
          const response = await requestCorpus(pathname, () => failingResponse(500), {
            method, headers: { 'if-none-match': etag },
          }).response;
          expect(response.status).toBe(503);
          expect(response.headers.get('cache-control')).toBe('no-store');
          if (method === 'HEAD') expect(await response.text()).toBe('');
          else expect(await response.text()).toContain('temporarily unavailable');
        }
      }
    },
  );

  test.each(families)('returns 503 for disposable session/cache setup failures at %s', async (pathname) => {
    for (const setup of [
      (outer) => { outer.pipeline.manifest.sessionConfig = {}; },
      (outer, State) => {
        outer.resolve = () => { throw new Error('SECRET CACHE SETUP'); };
        State.prototype.provide = () => {};
      },
    ]) {
      const harness = requestCorpus(pathname, null, {}, setup);
      const response = await harness.response;
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toContain('temporarily unavailable');
      expect(harness.rendered).toEqual([]);
      expect(harness.next).not.toHaveBeenCalled();
    }
  });

  test('does not fall through an unplanned chunk after a collection failure', async () => {
    const pathname = '/en/llms/missing-9999.txt';
    const healthyRequest = requestCorpus(pathname);
    expect((await healthyRequest.response).status).toBe(404);
    expect(healthyRequest.next).toHaveBeenCalledOnce();
    const failedRequest = requestCorpus(pathname, () => failingResponse(500));
    expect((await failedRequest.response).status).toBe(503);
    expect(failedRequest.next).not.toHaveBeenCalled();
  });

  test.each(families)('keeps build ownership at %s without attempting live collection', async (pathname) => {
    RUNTIME.buildOwnsCorpora = true;
    RUNTIME.dynamicPagesUnreachable = true;
    const fail = vi.fn(() => { throw new Error('Must not collect build-owned artifact'); });
    const harness = requestCorpus(pathname, fail);
    const response = await harness.response;
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('PROJECT FALLTHROUGH');
    expect(harness.rendered).toEqual([]);
    expect(fail).not.toHaveBeenCalled();
    expect(harness.next).toHaveBeenCalledOnce();
  });

  test.each(['build', 'preview'])('isolates concurrent failure and recovers on the next %s request', async (command) => {
    RUNTIME.command = command;
    let enterFailure;
    let releaseFailure;
    const entered = new Promise((resolve) => { enterFailure = resolve; });
    const release = new Promise((resolve) => { releaseFailure = resolve; });
    const failing = requestCorpus('/llms-full.txt', async () => {
      enterFailure();
      await release;
      throw new Error('SECRET CONCURRENT FAILURE');
    });
    await entered;
    const healthyRequest = requestCorpus('/llms-full.txt');
    const healthyResponse = await healthyRequest.response;
    releaseFailure();
    const failedResponse = await failing.response;
    expect(healthyResponse.status).toBe(200);
    expect(await healthyResponse.text()).toContain('/en/z-failing/');
    expect(failedResponse.status).toBe(503);
    expect(await failedResponse.text()).not.toContain('SECRET');
    const recovered = await requestCorpus('/llms-full.txt').response;
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toContain('/en/z-failing/');
    expect(healthyRequest.outer.locals).toEqual({ callerSecret: 'PRIVATE' });
  });

  test.each([204, 205, 301, 302, 307, 308, 400, 401, 403, 404, 410, 429])(
    'keeps intentional source status %s excluded without failing the aggregate', async (status) => {
      const response = await requestCorpus('/llms-full.txt', () => failingResponse(
        status, 'text/html', { location: '/login' }, [204, 205].includes(status) ? null : 'Private content',
      )).response;
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('/en/a-healthy/');
      expect(body).not.toContain('/en/z-failing/');
      expect(body).not.toContain('Private content');
    },
  );

  test.each(['application/json', 'text/plain', 'application/octet-stream'])(
    'excludes successful non-HTML %s responses', async (contentType) => {
      const response = await requestCorpus('/llms-full.txt', () => failingResponse(200, contentType)).response;
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('SECRET');
    },
  );

  test.each([
    ['noindex', '<meta name="robots" content="noindex">'],
    ['opt-out', '<meta name="aeo" content="skip">'],
    ['disabled generators', '<meta name="aeo" content="no-llms no-llms-full">'],
  ])('preserves %s page exclusions', async (_label, marker) => {
    const response = await requestCorpus('/llms-full.txt', () => new Response(
      html('/en/z-failing').replace('</head>', `${marker}</head>`),
      { headers: { 'content-type': 'text/html' } },
    )).response;
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('/en/a-healthy/');
    expect(body).not.toContain('/en/z-failing/');
  });

  test('never renders configuration-excluded pages', async () => {
    RUNTIME.config = { ...originalConfig, pages: { ...originalConfig.pages, exclude: ['/en/z-failing'] } };
    const fail = vi.fn(() => { throw new Error('Must not render an excluded page'); });
    const response = await requestCorpus('/llms-full.txt', fail).response;
    expect(response.status).toBe(200);
    expect(fail).not.toHaveBeenCalled();
  });
});
