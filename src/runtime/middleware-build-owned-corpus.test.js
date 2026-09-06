import { beforeEach, describe, expect, test, vi } from 'vitest';

// Issue #8. When every page route is prerendered the build writes real corpus bytes,
// but Astro-AEO's fallback routes were injected in config:setup and Astro offers no
// removeRoute, so the middleware is still reachable for those paths. A live render
// there cannot expand getStaticPaths(), so it would shadow the file with a shorter
// one. The middleware declines instead, and only when the two answers would differ.
vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig({ schema: { corpus: { enabled: true } } }),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      buildOwnsCorpora: true,
      dynamicPagesUnreachable: true,
      staticPaths: ['/'],
      projectPaths: [],
      projectPatterns: [],
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
const { resolveConfig } = await import('../config.js');

const INVENTORY_ARTIFACTS = [
  '/llms.txt',
  '/llms-full.txt',
  '/schema/graph.jsonld',
  '/schema/schema-map.xml',
];

beforeEach(() => {
  RUNTIME.command = 'preview';
  RUNTIME.config = resolveConfig({ schema: { corpus: { enabled: true } } });
  RUNTIME.buildOwnsCorpora = true;
  RUNTIME.dynamicPagesUnreachable = true;
});

/** @param {string} pathname */
async function requestArtifact(pathname) {
  const url = new URL(pathname, 'https://example.test');
  const passthrough = new Response('application response', { status: 404 });
  const next = vi.fn(async () => passthrough);
  const rewrite = vi.fn();
  const response = await onRequest(
    { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite },
    next,
  );
  return { response, next, rewrite };
}

describe('build-owned inventory artifacts', () => {
  test.each(INVENTORY_ARTIFACTS)('%s is declined without rendering a page', async (pathname) => {
    const { response, next, rewrite } = await requestArtifact(pathname);
    expect(next).toHaveBeenCalledTimes(1);
    expect(rewrite).not.toHaveBeenCalled();
    expect(await response.text()).toBe('application response');
  });

  test.each(INVENTORY_ARTIFACTS)(
    '%s is still served when no dynamic route is unreachable',
    async (pathname) => {
      // Without a dynamic page route the live answer matches the emitted bytes, so
      // declining would only turn a working response into the fallback route's 404.
      RUNTIME.dynamicPagesUnreachable = false;
      const { response, next } = await requestArtifact(pathname);
      // Reaching the unrecognized-request-state guard proves the artifact was claimed
      // here rather than declined: this harness supplies no disposable FetchState.
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('request state was not recognized');
      expect(next).not.toHaveBeenCalled();
    },
  );

  test.each(INVENTORY_ARTIFACTS)('%s is still served when the build did not own it', async (pathname) => {
    RUNTIME.buildOwnsCorpora = false;
    const { response, next } = await requestArtifact(pathname);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('request state was not recognized');
    expect(next).not.toHaveBeenCalled();
  });
});
