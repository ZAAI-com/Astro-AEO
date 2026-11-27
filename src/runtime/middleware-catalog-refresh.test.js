import { afterEach, expect, test, vi } from 'vitest';

// A revalidating catalog refreshes in the background. On Cloudflare Workers that
// work is cancelled when the request that started it finishes, so the middleware
// must hand it to `locals.cfContext.waitUntil` or the stale listing never clears.
const catalog = vi.hoisted(() => ({
  revision: 0,
  /** @type {Promise<void> | null} */
  gate: null,
  listPages: /** @type {any} */ (null),
}));

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  catalog.listPages = vi.fn(async () => {
    const revision = catalog.revision;
    if (catalog.gate) await catalog.gate;
    return [{ pathname: `/entry-${revision}` }];
  });
  return {
    RUNTIME: {
      command: 'build',
      config: resolveConfig({ markdown: { alternateLink: 'never' } }),
      site: {
        siteUrl: 'https://example.test',
        stableSiteUrl: 'https://example.test',
        base: '',
        trailingSlash: 'ignore',
      },
      staticPaths: ['/page'],
      projectPaths: ['/page'],
      projectPatterns: [],
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [
      { module: './cms.js', revalidate: 10, load: async () => ({ listPages: catalog.listPages }) },
    ],
    RUNTIME_DYNAMIC_ROUTE_SOURCE: null,
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
    RUNTIME_CORPUS_TOKENIZER_LOADER: undefined,
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const { pendingRuntimeCatalogRefresh } = await import('./serve.js');

const page = '<!doctype html><html><head><title>Page</title></head><body><main><h1>Page</h1></main></body></html>';

/** @param {Record<string, unknown>} locals */
const requestPage = (locals) => {
  const url = new URL('/page', 'https://example.test');
  return onRequest(
    { request: new Request(url), url, locals, isPrerendered: false, rewrite: vi.fn() },
    async () => new Response(page, { headers: { 'content-type': 'text/html' } }),
  );
};

afterEach(() => {
  vi.useRealTimers();
});

test('hands a background catalog refresh to cfContext.waitUntil and nothing else', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
  const waitUntil = vi.fn();
  const locals = {
    cfContext: { waitUntil },
    // The Cloudflare adapter makes this throw on access; the middleware must not touch it.
    get runtime() {
      throw new Error('locals.runtime was read');
    },
  };

  // The first listing is awaited inside the request, so there is nothing to keep alive.
  expect((await requestPage(locals)).status).toBe(200);
  expect(catalog.listPages).toHaveBeenCalledOnce();
  expect(waitUntil).not.toHaveBeenCalled();

  catalog.revision = 1;
  /** @type {() => void} */
  let release = () => {};
  catalog.gate = new Promise((resolve) => { release = resolve; });
  vi.setSystemTime(10_000);
  // Like a database read on a Worker, the refresh is still running when the response is ready.
  expect((await requestPage(locals)).status).toBe(200);
  expect(catalog.listPages).toHaveBeenCalledTimes(2);
  const pending = pendingRuntimeCatalogRefresh(RUNTIME);
  expect(pending).toBeInstanceOf(Promise);
  expect(waitUntil).toHaveBeenCalledOnce();
  expect(waitUntil).toHaveBeenCalledWith(pending);
  catalog.gate = null;
  release();
  await pending;
  expect(pendingRuntimeCatalogRefresh(RUNTIME)).toBeUndefined();

  // Once the refresh settled, a later request registers nothing.
  expect((await requestPage(locals)).status).toBe(200);
  expect(waitUntil).toHaveBeenCalledOnce();
});

test('a runtime without cfContext answers normally while a refresh runs', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(100_000);
  expect((await requestPage({})).status).toBe(200);
  const throwing = { cfContext: { waitUntil: () => { throw new Error('refused'); } } };
  vi.setSystemTime(200_000);
  expect((await requestPage(throwing)).status).toBe(200);
});
