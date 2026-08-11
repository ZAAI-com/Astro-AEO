import { describe, expect, test, vi } from 'vitest';

const claims = [
  { id: 'feed', pathname: '/feed.txt' },
  { id: 'project', pathname: '/project.txt' },
];

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({
        corpus: { index: { enabled: false }, full: { enabled: false } },
      }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: [],
      projectPaths: ['/project.txt'],
      projectPatterns: [],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
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
          api.on('page:metadata', ({ value }) => ({
            action: 'replace',
            value: { ...value, title: 'Runtime plugin title' },
          }));
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
          api.on('artifact:generate', ({ value }) => ({
            action: 'replace',
            value: {
              claim: value.claim,
              representation: {
                body: `plugin:${value.claim.id}\n`,
                contentType: 'text/plain; charset=utf-8',
              },
            },
          }));
          api.on('artifact:validate', () => ({ action: 'keep' }));
        },
      }),
    }],
  };
});

const { onRequest } = await import('./middleware.js');

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

describe('runtime plugin middleware integration', () => {
  test('serves an exact plugin artifact before the application route', async () => {
    const next = vi.fn();
    const response = await onRequest(context('/feed.txt'), next);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(await response.text()).toBe('plugin:feed\n');
    expect(next).not.toHaveBeenCalled();
  });

  test('preserves a literal project route without per-claim replacement', async () => {
    const next = vi.fn(async () => new Response('project', {
      headers: { 'content-type': 'text/plain' },
    }));
    const response = await onRequest(context('/project.txt'), next);

    expect(await response.text()).toBe('project');
    expect(next).toHaveBeenCalledOnce();
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
});
