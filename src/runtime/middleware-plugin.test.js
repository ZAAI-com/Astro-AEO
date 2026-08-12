import { describe, expect, test, vi } from 'vitest';

const claims = [
  { id: 'feed', pathname: '/feed.txt' },
  { id: 'project', pathname: '/project.txt' },
  { id: 'catalog-feed', pathname: '/catalog-feed.txt' },
  { id: 'core-index', pathname: '/llms.txt', replace: true },
  { id: 'page-companion', pathname: '/page.md' },
  { id: 'missing-companion', pathname: '/missing.md' },
  { id: 'disabled-companion', pathname: '/disabled.md' },
  { id: 'isolated-companion', pathname: '/isolated.md' },
];

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({
        artifacts: { replace: ['/project.txt'] },
        corpus: { index: { enabled: false }, full: { enabled: false } },
      }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: [],
      projectPaths: ['/project.txt'],
      projectPatterns: [],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [{
      module: './catalog.js',
      load: async () => ({
        listPages: async () => [{
          pathname: '/catalog-page',
          title: 'Catalog title',
          description: 'Catalog description',
          markdown: '# Private catalog source',
          source: { kind: 'cms', body: 'private catalog payload' },
          directives: { generateMarkdown: false },
        }],
      }),
    }],
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [{
      name: 'feed',
      module: './feed-runtime.js',
      stages: ['page:metadata', 'graph:build', 'artifact:generate', 'artifact:validate'],
      claims,
      load: async () => ({
        name: 'feed',
        apiVersion: 1,
        setup(api) {
          for (const claim of claims) api.claimArtifact(claim);
          api.on('page:metadata', ({ value, pathname }) => {
            if (pathname === '/isolated') throw new Error('private lifecycle failure');
            return {
              action: 'replace',
              value: { ...value, title: 'Runtime plugin title' },
            };
          });
          api.on('graph:build', ({ value }) => {
            if (!value.graph?.entries?.length) throw new Error('internal semantic plugin did not run first');
            return {
              action: 'replace',
              value: {
                ...value,
                html: value.html.replace('</head>', '<meta name="runtime-plugin" content="preview"></head>'),
              },
            };
          });
          api.on('artifact:generate', async ({ value, pages }) => {
            let body = `plugin:${value.claim.id}\n`;
            if (value.claim.id === 'catalog-feed') {
              const handle = pages.find((page) => page.pathname === '/catalog-page');
              const page = await handle?.read();
              body = `${JSON.stringify({
                handleKeys: handle ? Object.keys(handle).sort() : [],
                readArity: handle?.read.length,
                title: page?.metadata?.title,
                representations: page?.representations,
                hasSource: page ? Object.prototype.hasOwnProperty.call(page, 'source') : true,
              })}\n`;
            }
            return {
              action: 'replace',
              value: {
                claim: value.claim,
                representation: {
                  body,
                  contentType: 'text/plain; charset=utf-8',
                },
              },
            };
          });
          api.on('artifact:validate', () => ({ action: 'keep' }));
        },
      }),
    }],
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const { resolveConfig } = await import('../config.js');
const FETCH_STATE = Symbol.for('astro.fetchState');

function context(pathname, init = {}) {
  const url = new URL(pathname, 'https://example.test');
  return {
    request: new Request(url, init),
    url,
    locals: {},
    isPrerendered: false,
    rewrite: vi.fn(),
  };
}

function disposableContext(pathname, init, render) {
  const url = new URL(pathname, 'https://example.test');
  const request = new Request(url, init);
  const rewrites = [];
  class FakeState {
    constructor(pipeline, stateRequest, options = {}) {
      this.pipeline = pipeline;
      this.request = stateRequest;
      this.renderOptions = options;
      this.locals = options.locals ?? {};
      this.cookies = { request: stateRequest };
    }
    async rewrite(target) {
      rewrites.push(target);
      return onRequest({
        request: target,
        url: new URL(target.url),
        locals: this.locals,
        isPrerendered: false,
        rewrite: this.rewrite.bind(this),
        [FETCH_STATE]: this,
      }, vi.fn(() => this.pipeline.render(target, this)));
    }
  }
  const pipeline = { manifest: {}, render };
  const state = new FakeState(pipeline, request, { locals: {} });
  return {
    context: {
      request,
      url,
      locals: state.locals,
      isPrerendered: false,
      rewrite: state.rewrite.bind(state),
      [FETCH_STATE]: state,
    },
    rewrites,
  };
}

describe('runtime plugin middleware integration', () => {
  test('serves an exact plugin artifact before the application route', async () => {
    const next = vi.fn();
    const response = await onRequest(context('/feed.txt'), next);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(await response.text()).toBe('plugin:feed\n');
    expect(next).not.toHaveBeenCalled();
  });

  test('does not let a core replacement authorization replace a plugin claim', async () => {
    const next = vi.fn(async () => new Response('project', {
      headers: { 'content-type': 'text/plain' },
    }));
    const response = await onRequest(context('/project.txt'), next);

    expect(await response.text()).toBe('project');
    expect(next).toHaveBeenCalledOnce();
  });

  test('keeps a configured core claim colliding when a project route blocks core output', async () => {
    const priorConfig = RUNTIME.config;
    const priorPaths = RUNTIME.projectPaths;
    RUNTIME.config = resolveConfig({
      corpus: { index: { enabled: true }, full: { enabled: false } },
    });
    RUNTIME.projectPaths = [...(priorPaths ?? []), '/llms.txt'];
    const next = vi.fn(async () => new Response('project index'));

    try {
      const response = await onRequest(context('/llms.txt'), next);

      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('Internal Server Error\n');
      expect(next).not.toHaveBeenCalled();
    } finally {
      RUNTIME.config = priorConfig;
      RUNTIME.projectPaths = priorPaths;
    }
  });

  test('fails a plugin claim closed when an eligible Markdown companion owns the path', async () => {
    const harness = disposableContext('/page.md', {}, async () => new Response(
      '<!doctype html><html><head><title>Page</title></head><body><main>Page</main></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    ));

    const response = await onRequest(harness.context, vi.fn());

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Internal Server Error\n');
    expect(harness.rewrites).toHaveLength(2);
  });

  test('fails a plugin claim closed when companion lifecycle enrichment is isolated', async () => {
    const harness = disposableContext('/isolated.md', {}, async () => new Response(
      '<!doctype html><html><head><title>Isolated</title></head><body><main>Isolated</main></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    ));

    const response = await onRequest(harness.context, vi.fn());

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Internal Server Error\n');
    expect(harness.rewrites).toHaveLength(2);
  });

  test.each([
    ['missing', '/missing.md', () => new Response(null, { status: 404 })],
    [
      'HTML 404',
      '/missing.md',
      () => new Response(
        '<!doctype html><html><head><title>Missing</title></head><body><main>Missing</main></body></html>',
        { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    ],
    [
      'opted-out',
      '/disabled.md',
      () => new Response(
        '<!doctype html><html><head><title>Disabled</title><meta name="aeo" content="no-dotmd"></head><body><main>Disabled</main></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    ],
  ])('allows a plugin claim when its source page is %s', async (_case, pathname, render) => {
    const harness = disposableContext(pathname, {}, render);

    const response = await onRequest(harness.context, vi.fn());

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^plugin:(missing|disabled)-companion\n$/);
    expect(harness.rewrites.length).toBeGreaterThan(0);
  });

  test('gives runtime plugins anonymous lazy handles for catalog-known pages', async () => {
    const harness = disposableContext('/catalog-feed.txt?private=query', {
      headers: {
        authorization: 'Bearer caller-secret',
        cookie: 'session=caller-secret',
      },
    }, async (target) => {
      expect(new URL(target.url).pathname).toBe('/catalog-page/');
      expect(new URL(target.url).search).toBe('');
      expect(target.method).toBe('GET');
      expect(target.headers.get('authorization')).toBeNull();
      expect(target.headers.get('cookie')).toBeNull();
      expect(target.headers.get('cache-control')).toBe('no-store');
      expect(target.headers.get('x-astro-aeo-internal-purpose')).toBe('corpus');
      return new Response(
        '<!doctype html><html><head><title>Rendered title</title></head><body><main>Rendered body</main></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });

    const response = await onRequest(harness.context, vi.fn());
    expect(response.status).toBe(200);
    expect(harness.rewrites).toHaveLength(1);
    expect(JSON.parse(await response.text())).toEqual({
      handleKeys: ['id', 'pathname', 'read'],
      readArity: 0,
      title: 'Runtime plugin title',
      representations: {
        markdown: '# Private catalog source',
        plainText: 'Rendered body',
      },
      hasSource: false,
    });
  });

  test('runs runtime page hooks after internal semantic graph enrichment', async () => {
    const source = '<!doctype html><html><head><title>Original</title></head><body><main><h1>Page</h1></main></body></html>';
    const next = vi.fn(async () => new Response(source, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    const response = await onRequest(context('/page'), next);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('data-astro-aeo-graph');
    expect(body).toContain('<meta name="runtime-plugin" content="preview">');
    expect(body).toContain('Runtime plugin title');
    expect(next).toHaveBeenCalledOnce();
  });

  test('uses the matching catalog descriptor for ordinary runtime HTML enrichment', async () => {
    const source = '<!doctype html><html><head><title>Rendered title</title></head><body><main>Rendered body</main></body></html>';
    const next = vi.fn(async () => new Response(source, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    const response = await onRequest(context('/catalog-page'), next);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"description":"Catalog description"');
    expect(body).toContain('Runtime plugin title');
    expect(body).not.toContain('type="text/markdown"');
    expect(next).toHaveBeenCalledOnce();
  });
});
