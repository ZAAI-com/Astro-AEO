import { describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'build',
      config: resolveConfig({
        corpus: { manifest: { enabled: true }, chunks: { enabled: true } },
        schema: { corpus: { enabled: true } },
      }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: ['/a-public', '/z-source'],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_DYNAMIC_ROUTE_SOURCE: null,
    RUNTIME_DEV_LOOPBACK_SOURCE: null,
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
    RUNTIME_CORPUS_TOKENIZER_LOADER: undefined,
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const { RuntimeCorpusCollectionError, serveCorpusArtifact, serveSchemaCorpus } = await import('./serve.js');
const FETCH_STATE = Symbol.for('astro.fetchState');
const PRIVATE = 'PRIVATE_RENDER_DETAIL';
const PUBLIC = '<html><head><title>Public</title></head><body><main><h1>Public</h1></main></body></html>';

function htmlResponse(body = PUBLIC, init = {}) {
  return new Response(body, { ...init, headers: { 'content-type': 'text/html', ...init.headers } });
}

async function requestCorpus(pathname, method, source, conditional = true) {
  const rewritten = [];
  const request = new Request(`https://example.test${pathname}?caller=private`, {
    method,
    headers: {
      authorization: 'Bearer caller-secret',
      cookie: 'session=caller-secret',
      ...(conditional ? { 'if-none-match': '*' } : {}),
    },
  });
  class FakeState {
    constructor(pipeline, stateRequest, options = {}) {
      this.pipeline = pipeline;
      this.request = stateRequest;
      this.renderOptions = options;
      this.locals = options.locals ?? {};
      this.cookies = { request: stateRequest };
    }
    async rewrite(target) {
      const url = new URL(target.url);
      rewritten.push(url.pathname);
      expect(target.method).toBe('GET');
      expect(url.search).toBe('');
      expect(target.headers.get('authorization')).toBeNull();
      expect(target.headers.get('cookie')).toBeNull();
      expect(this.locals.callerSecret).toBeUndefined();
      return onRequest({
        request: target,
        url,
        locals: this.locals,
        isPrerendered: false,
        rewrite: this.rewrite.bind(this),
        [FETCH_STATE]: this,
      }, async () => url.pathname === '/a-public/' ? htmlResponse() : source());
    }
  }
  const outer = new FakeState({ manifest: {} }, request, { locals: { callerSecret: PRIVATE } });
  const next = vi.fn();
  const response = await onRequest({
    request,
    url: new URL(request.url),
    locals: outer.locals,
    isPrerendered: false,
    rewrite: outer.rewrite.bind(outer),
    [FETCH_STATE]: outer,
  }, next);
  expect(next).not.toHaveBeenCalled();
  expect(outer.locals).toEqual({ callerSecret: PRIVATE });
  return { response, rewritten };
}

const failures = [
  ['render rejection', () => { throw new Error(PRIVATE); }],
  ['HTML server error', () => htmlResponse(PRIVATE, { status: 500 })],
  ['non-HTML server error', () => new Response(PRIVATE, { status: 503 })],
  ['partial HTML', () => htmlResponse(PRIVATE, { status: 206 })],
  ['unexpected content range', () => htmlResponse(PRIVATE, { headers: { 'content-range': 'bytes 0-19/100' } })],
  ['compressed HTML', () => htmlResponse(PRIVATE, { headers: { 'content-encoding': 'gzip' } })],
  ['unsupported HTML charset', () => htmlResponse(PRIVATE, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } })],
  ['unexpected conditional response', () => new Response(null, { status: 304 })],
  ['body-read rejection', () => htmlResponse(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(PRIVATE));
      controller.error(new Error(PRIVATE));
    },
  }))],
];

describe.each([
  '/llms.txt',
  '/llms-full.txt',
  '/llms/manifest.json',
  '/llms/pages-0001.txt',
  '/schema/graph.jsonld',
  '/schema/schema-map.xml',
])('incomplete runtime corpus %s', (pathname) => {
  test.each(failures)('fails closed for %s after a page already succeeded', async (_name, source) => {
    for (const method of ['GET', 'HEAD']) {
      const { response, rewritten } = await requestCorpus(pathname, method, source);
      expect(rewritten).toEqual(['/a-public/', '/z-source/']);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('set-cookie')).toBeNull();
      const expected = pathname.startsWith('/schema/')
        ? 'astro-aeo: the semantic corpus is temporarily unavailable.\n'
        : 'astro-aeo: the corpus is temporarily unavailable.\n';
      expect(await response.text()).toBe(method === 'HEAD' ? '' : expected);
    }
  });
});

describe('intentional anonymous corpus exclusions', () => {
  test.each([
    ['authentication', () => htmlResponse(PRIVATE, { status: 401 })],
    ['authorization', () => htmlResponse(PRIVATE, { status: 403 })],
    ['missing route', () => htmlResponse(PRIVATE, { status: 404 })],
    ['gone route', () => htmlResponse(PRIVATE, { status: 410 })],
    ['intentional client exclusion', () => htmlResponse(PRIVATE, { status: 429 })],
    ['redirect', () => htmlResponse(PRIVATE, { status: 302, headers: { location: '/login' } })],
    ['non-HTML route', () => new Response(PRIVATE, { headers: { 'content-type': 'application/json' } })],
    ['empty route', () => new Response(null, { status: 204 })],
    ['noindex', () => htmlResponse(`<html><head><meta name="robots" content="noindex"></head><body><main>${PRIVATE}</main></body></html>`)],
  ])('does not fail collection for %s', async (_name, source) => {
    for (const pathname of ['/llms-full.txt', '/schema/graph.jsonld']) {
      const { response } = await requestCorpus(pathname, 'GET', source, false);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).not.toBe('no-store');
      const body = await response.text();
      expect(body).toContain('Public');
      expect(body).not.toContain(PRIVATE);
    }
  });
});

describe('direct collection outcomes', () => {
  test.each([
    ['missing transport result', async () => null],
    ['transport rejection', async () => { throw new Error(PRIVATE); }],
    ['unreadable expected HTML', async () => ({ html: null, response: htmlResponse() })],
  ])('rejects %s without retaining private failure details', async (_name, fetchHtml) => {
    for (const collect of [
      () => serveCorpusArtifact('/llms-full.txt', RUNTIME, fetchHtml),
      () => serveSchemaCorpus('schema-graph', RUNTIME, fetchHtml),
    ]) {
      await expect(collect()).rejects.toEqual(new RuntimeCorpusCollectionError());
    }
  });
});
