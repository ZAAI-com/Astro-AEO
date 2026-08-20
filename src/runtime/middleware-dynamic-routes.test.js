import { beforeEach, describe, expect, test, vi } from 'vitest';

const discovery = vi.hoisted(() => ({ loads: 0 }));
const secret = 'SECRET_GET_STATIC_PATHS_FAILURE';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'dev',
      config: resolveConfig({ schema: { corpus: { enabled: true } } }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: ['/ordinary'],
      projectPaths: ['/ordinary'],
      projectPatterns: [],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_DYNAMIC_ROUTE_SOURCE: {
      mode: 'startup',
      load: async () => {
        discovery.loads++;
        return {
          list: () => [{
            entrypoint: 'src/pages/products/[slug].astro',
            pattern: '/products/[slug]',
            params: ['slug'],
            segments: [
              [{ content: 'products', dynamic: false, spread: false }],
              [{ content: 'slug', dynamic: true, spread: false }],
            ],
            load: async () => ({
              getStaticPaths() {
                throw new Error(secret);
              },
            }),
          }],
        };
      },
    },
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [{
      name: 'feed',
      module: './feed.js',
      stages: ['artifact:generate'],
      claims: [{ id: 'feed', pathname: '/feed.txt' }],
      load: async () => ({
        name: 'feed',
        apiVersion: 1,
        setup(api) {
          api.claimArtifact({ id: 'feed', pathname: '/feed.txt' });
          api.on('artifact:generate', () => ({ body: 'feed' }));
        },
      }),
    }],
    RUNTIME_CORPUS_TOKENIZER_LOADER: undefined,
  };
});

const { onRequest } = await import('./middleware.js');
const FETCH_STATE = Symbol.for('astro.fetchState');

function context(pathname, disposable = true) {
  const url = new URL(pathname, 'https://example.test');
  const request = new Request(url);
  const value = {
    request,
    url,
    locals: {},
    isPrerendered: false,
    rewrite: vi.fn(),
  };
  if (!disposable) return value;
  class FakeState {
    constructor() {
      this.pipeline = {};
    }
    async rewrite() {
      throw new Error('discovery must fail before page fan-out');
    }
  }
  value[FETCH_STATE] = new FakeState();
  return value;
}

beforeEach(() => {
  discovery.loads = 0;
});

describe('dynamic route discovery middleware failures', () => {
  test.each(['/llms.txt', '/schema/graph.jsonld', '/feed.txt'])(
    'returns a sanitized no-store 500 for %s',
    async (pathname) => {
      const next = vi.fn();
      const response = await onRequest(context(pathname), next);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toContain('/products/[slug]');
      expect(body).not.toContain(secret);
      expect(next).not.toHaveBeenCalled();
      expect(discovery.loads).toBe(1);
    },
  );

  test('does not discover routes for an ordinary HTML request', async () => {
    const source = new Response(
      '<!doctype html><html><head><title>Ordinary</title></head><body><main>Ordinary</main></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
    const response = await onRequest(context('/ordinary'), vi.fn(async () => source));
    expect(response.status).toBe(200);
    expect(discovery.loads).toBe(0);
  });

  test('keeps the legacy corpus guard ahead of discovery', async () => {
    const response = await onRequest(context('/llms.txt', false), vi.fn());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Astro 6.3 or newer');
    expect(discovery.loads).toBe(0);
  });
});
