import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({
        corpus: {
          index: { enabled: false },
          full: { enabled: false },
        },
        schema: { corpus: { enabled: true } },
      }),
      site: {
        siteUrl: 'https://example.test',
        base: '',
        trailingSlash: 'ignore',
      },
      staticPaths: ['/zeta', '/alpha'],
      projectPaths: ['/zeta', '/alpha'],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME, RUNTIME_PLUGIN_LOADERS } = await import('./config.js');
const { resolveConfig } = await import('../config.js');
const FETCH_STATE = Symbol.for('astro.fetchState');

const pageHtml = (title, extraHead = '') =>
  `<!doctype html><html><head><title>${title}</title>${extraHead}</head><body><main><h1>${title}</h1></main></body></html>`;

/**
 * Model the disposable FetchState surface available in Astro 6.3 and newer.
 * Every rewritten page re-enters the middleware using a fresh state instance.
 */
function disposableHarness({ request, render }) {
  const rewritten = [];
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
      rewritten.push(target);
      const url = new URL(target.url);
      return onRequest(
        {
          request: target,
          url,
          locals: this.locals,
          isPrerendered: false,
          rewrite: this.rewrite.bind(this),
          [FETCH_STATE]: this,
        },
        vi.fn(() => this.pipeline.render(target, this)),
      );
    }
  }

  const pipeline = { manifest: {}, render };
  const outer = new FakeState(pipeline, request, {
    locals: { callerIdentity: 'must-not-enter-corpus' },
  });
  return {
    context: {
      request,
      url: new URL(request.url),
      locals: outer.locals,
      isPrerendered: false,
      rewrite: outer.rewrite.bind(outer),
      [FETCH_STATE]: outer,
    },
    instances,
    rewritten,
  };
}

async function requestCorpus(pathname, init = {}, render = renderPage) {
  const request = new Request(`https://request-host.invalid${pathname}`, init);
  const harness = disposableHarness({ request, render });
  const next = vi.fn();
  const response = await onRequest(harness.context, next);
  return { harness, next, response };
}

async function renderPage(target, state) {
  expect(target).toBeInstanceOf(Request);
  const pathname = new URL(target.url).pathname;
  const title = pathname === '/alpha/' ? 'Alpha' : 'Zeta';
  return new Response(pageHtml(title), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

beforeEach(() => {
  RUNTIME.config = resolveConfig({
    corpus: { index: { enabled: false }, full: { enabled: false } },
    schema: { corpus: { enabled: true } },
  });
  RUNTIME.site.base = '';
  RUNTIME.projectPaths = ['/zeta', '/alpha'];
  RUNTIME.projectPatterns = [];
  RUNTIME_PLUGIN_LOADERS.splice(0);
});

afterEach(() => vi.unstubAllGlobals());

describe('runtime schema corpus middleware', () => {
  test.each(['GET', 'HEAD'])('serves an encoded schema pathname for %s', async (method) => {
    RUNTIME.config = resolveConfig({
      corpus: { index: { enabled: false }, full: { enabled: false } },
      schema: {
        corpus: {
          enabled: true,
          graphPath: '/schema/graph%20data.jsonld',
          mapPath: '/schema/schema-map%20data.xml',
        },
      },
    });

    const result = await requestCorpus('/schema/graph%20data.jsonld', { method });

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('content-type')).toBe(
      'application/ld+json; charset=utf-8',
    );
    const body = await result.response.text();
    if (method === 'HEAD') expect(body).toBe('');
    else expect(body).toContain('https://example.test/alpha');
    expect(result.next).not.toHaveBeenCalled();
  });

  test('suppresses both schema members when one exact external route owns a member', async () => {
    RUNTIME.projectPaths.push('/schema/graph.jsonld');
    const graphUrl = new URL('https://example.test/schema/graph.jsonld');
    const graphSource = new Response('project graph', {
      headers: { 'content-type': 'application/ld+json', 'x-owner': 'project' },
    });
    const graphNext = vi.fn(async () => graphSource);
    const graph = await onRequest({
      request: new Request(graphUrl),
      url: graphUrl,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, graphNext);

    const mapUrl = new URL('https://example.test/schema/schema-map.xml');
    const fallback = new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    });
    const mapNext = vi.fn(async () => fallback);
    const map = await onRequest({
      request: new Request(mapUrl),
      url: mapUrl,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, mapNext);

    expect(graph).toBe(graphSource);
    expect(await graph.text()).toBe('project graph');
    expect(graph.headers.get('x-owner')).toBe('project');
    expect(graphNext).toHaveBeenCalledOnce();
    expect(map).toBe(fallback);
    expect(map.status).toBe(404);
    expect(mapNext).toHaveBeenCalledOnce();
  });

  test('suppresses both schema members when a dynamic external route owns a member', async () => {
    RUNTIME.projectPatterns = [/^\/schema\/schema-map\.xml$/];
    for (const pathname of ['/schema/graph.jsonld', '/schema/schema-map.xml']) {
      const url = new URL(`https://example.test${pathname}`);
      const source = new Response(pathname.endsWith('.xml') ? 'dynamic project map' : null, {
        status: pathname.endsWith('.xml') ? 200 : 404,
        headers: { 'x-owner': pathname.endsWith('.xml') ? 'integration' : 'fallback' },
      });
      const next = vi.fn(async () => source);
      const response = await onRequest({
        request: new Request(url),
        url,
        locals: {},
        isPrerendered: false,
        rewrite: vi.fn(),
      }, next);

      expect(response).toBe(source);
      expect(response.headers.get('x-owner')).toBe(
        pathname.endsWith('.xml') ? 'integration' : 'fallback',
      );
      expect(next).toHaveBeenCalledOnce();
    }
  });

  test('an exact core replacement keeps an externally owned schema pair enabled', async () => {
    RUNTIME.projectPaths.push('/schema/graph.jsonld');
    RUNTIME.config = resolveConfig({
      artifacts: { replace: ['/schema/graph.jsonld'] },
      corpus: { index: { enabled: false }, full: { enabled: false } },
      schema: { corpus: { enabled: true } },
    });

    const result = await requestCorpus('/schema/schema-map.xml');

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(result.next).not.toHaveBeenCalled();
  });

  test.each([
    ['/schema/graph.jsonld', '/schema/schema-map.xml'],
    ['/schema/schema-map.xml', '/schema/graph.jsonld'],
  ])('a plugin claim on %s collides there and suppresses its peer', async (claimed, peer) => {
    RUNTIME.projectPaths.push(claimed);
    RUNTIME_PLUGIN_LOADERS.push({
      name: 'schema-plugin',
      module: './schema-plugin.js',
      stages: [],
      claims: [{ id: 'schema-collision', pathname: claimed, replace: true }],
      load: async () => ({ name: 'schema-plugin', apiVersion: 1, setup() {} }),
    });

    const claimedUrl = new URL(`https://example.test${claimed}`);
    const claimedNext = vi.fn(async () => new Response('project member'));
    const collision = await onRequest({
      request: new Request(claimedUrl),
      url: claimedUrl,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, claimedNext);
    expect(collision.status).toBe(500);
    expect(collision.headers.get('cache-control')).toBe('no-store');
    expect(await collision.text()).toBe('Internal Server Error\n');
    expect(claimedNext).not.toHaveBeenCalled();

    const peerUrl = new URL(`https://example.test${peer}`);
    const fallback = new Response(null, { status: 404, headers: { 'x-owner': 'fallback' } });
    const peerNext = vi.fn(async () => fallback);
    const declined = await onRequest({
      request: new Request(peerUrl),
      url: peerUrl,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(),
    }, peerNext);
    expect(declined).toBe(fallback);
    expect(declined.status).toBe(404);
    expect(peerNext).toHaveBeenCalledOnce();
  });

  test('serves deterministic graph and map representations through anonymous serial rewrites', async () => {
    let active = 0;
    let peak = 0;
    const observedLocals = [];
    const render = vi.fn(async (target, state) => {
      expect(target.method).toBe('GET');
      expect(target.headers.get('authorization')).toBeNull();
      expect(target.headers.get('cookie')).toBeNull();
      expect(target.headers.get('accept')).toBe('text/html, application/xhtml+xml');
      expect(target.headers.get('accept-encoding')).toBe('identity');
      expect(target.headers.get('if-none-match')).toBeNull();
      expect(target.headers.get('x-astro-aeo-internal-purpose')).toBe('corpus');
      expect(target.headers.get('cache-control')).toBe('no-store');
      expect(target.cache).toBe('no-store');
      expect(state.locals.callerIdentity).toBeUndefined();
      expect(state.locals.previousPage).toBeUndefined();
      observedLocals.push(state.locals);
      state.locals.previousPage = new URL(target.url).pathname;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return renderPage(target, state);
    });
    const networkFetch = vi.fn();
    vi.stubGlobal('fetch', networkFetch);

    const requestHeaders = {
      accept: 'application/ld+json',
      'accept-encoding': 'gzip',
      authorization: 'Bearer caller-secret',
      cookie: 'session=caller-secret',
      'if-none-match': '"caller-tag"',
    };
    const firstGraph = await requestCorpus('/schema/graph.jsonld?view=full', {
      headers: requestHeaders,
    }, render);
    const secondGraph = await requestCorpus('/schema/graph.jsonld', {}, render);
    const map = await requestCorpus('/schema/schema-map.xml', {}, render);
    const firstBody = await firstGraph.response.text();
    const secondBody = await secondGraph.response.text();
    const mapBody = await map.response.text();

    expect(firstGraph.response.status).toBe(200);
    expect(firstGraph.response.headers.get('content-type')).toBe(
      'application/ld+json; charset=utf-8',
    );
    expect(firstBody).toBe(secondBody);
    expect(firstBody).toContain('"@id":"https://example.test/alpha/#webpage"');
    expect(firstBody.indexOf('/alpha/#webpage')).toBeLessThan(
      firstBody.indexOf('/zeta/#webpage'),
    );
    expect(firstBody).not.toContain('request-host.invalid');
    expect(firstBody).not.toContain('caller-secret');

    expect(map.response.status).toBe(200);
    expect(map.response.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(mapBody).toContain('xmlns="https://zaai.com/astro-aeo/schema-map/1"');
    expect(mapBody).toContain('graph="https://example.test/schema/graph.jsonld"');
    expect(mapBody.indexOf('/alpha')).toBeLessThan(mapBody.indexOf('/zeta'));
    expect(mapBody).not.toContain('request-host.invalid');

    expect(render).toHaveBeenCalledTimes(6);
    expect(peak).toBe(1);
    expect(new Set(observedLocals).size).toBe(6);
    expect(firstGraph.harness.context.locals).toEqual({
      callerIdentity: 'must-not-enter-corpus',
    });
    expect(firstGraph.next).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  test('supports HEAD and conditional ETag responses for both corpus files', async () => {
    const graph = await requestCorpus('/schema/graph.jsonld');
    const graphBody = await graph.response.text();
    const graphEtag = graph.response.headers.get('etag');
    expect(graph.response.status).toBe(200);
    expect(graphBody).not.toBe('');
    expect(graphEtag).toMatch(/^"[a-f0-9]{64}"$/);

    const conditional = await requestCorpus('/schema/graph.jsonld', {
      headers: { 'if-none-match': `W/${graphEtag}` },
    });
    expect(conditional.response.status).toBe(304);
    expect(conditional.response.headers.get('etag')).toBe(graphEtag);
    expect(conditional.response.headers.get('content-type')).toBeNull();
    expect(await conditional.response.text()).toBe('');

    const mapHead = await requestCorpus('/schema/schema-map.xml', { method: 'HEAD' });
    expect(mapHead.response.status).toBe(200);
    expect(mapHead.response.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(mapHead.response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(await mapHead.response.text()).toBe('');
  });

  test('returns a generic no-store 500 when corpus-dependent semantic input is invalid', async () => {
    const secret = 'private-entity-value';
    const result = await requestCorpus('/schema/graph.jsonld', {}, async (target) => {
      const pathname = new URL(target.url).pathname;
      return new Response(
        pageHtml(
          pathname === '/alpha/' ? 'Alpha' : 'Zeta',
          `<script type="application/ld+json">{"name":"${secret}",}</script>`,
        ),
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const body = await result.response.text();

    expect(result.response.status).toBe(500);
    expect(result.response.headers.get('cache-control')).toBe('no-store');
    expect(result.response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).toBe('astro-aeo: the semantic corpus is temporarily unavailable.\n');
    expect(body).not.toContain(secret);
    expect(body).not.toContain('SyntaxError');
    expect(result.next).not.toHaveBeenCalled();
  });

  test.each([
    ['/schema/graph.jsonld', 'GET'],
    ['/schema/graph.jsonld', 'HEAD'],
    ['/schema/schema-map.xml', 'GET'],
    ['/schema/schema-map.xml', 'HEAD'],
  ])('fails closed before Astro 6.3 for %s %s', async (pathname, method) => {
    const url = new URL(`https://example.test${pathname}`);
    const request = new Request(url, {
      method,
      headers: {
        authorization: 'Bearer caller-secret',
        cookie: 'session=caller-secret',
        'if-none-match': '"matching-must-not-win"',
      },
    });
    const context = {
      request,
      url,
      locals: { callerIdentity: 'private' },
      isPrerendered: false,
      rewrite: vi.fn(),
      [Symbol.for('astro.pipeline')]: { manifest: {} },
    };
    const next = vi.fn();

    const response = await onRequest(context, next);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await response.text();
    if (method === 'HEAD') expect(body).toBe('');
    else expect(body).toContain('require Astro 6.3 or newer');
    expect(next).not.toHaveBeenCalled();
    expect(context.rewrite).not.toHaveBeenCalled();
    expect(context.locals).toEqual({ callerIdentity: 'private' });
  });
});
