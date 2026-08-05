import { describe, expect, test, vi } from 'vitest';
import { resolveConfig } from '../config.js';
import {
  collectConcurrently,
  RuntimeCorpusLimitError,
  serveLlmsIndex,
  serveMarkdown,
} from './serve.js';

const html = (title = 'Page') =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;

const runtime = (staticPaths = [], maxPages = 50) => ({
  command: 'dev',
  config: resolveConfig({ corpus: { runtime: { maxPages } } }),
  site: { siteUrl: 'https://example.com', base: '', trailingSlash: 'ignore' },
  staticPaths,
  projectPaths: staticPaths,
  internalRequestToken: 'test-token',
  standaloneSources: {},
});

const loaded = (body = html()) => ({
  html: body,
  response: new Response(body, { headers: { 'content-type': 'text/html' } }),
});

describe('request-time corpus limits', () => {
  test('renders exactly 50 pages under the default boundary', async () => {
    const fetcher = vi.fn(async (pathname) => loaded(html(pathname)));
    const body = await serveLlmsIndex(
      'llms',
      runtime(Array.from({ length: 50 }, (_, index) => `/p-${index}`), 50),
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(50);
    expect(body).toContain('/p-49.md');
  });

  test('refuses above the configured limit before rendering any page', async () => {
    const fetcher = vi.fn(async () => loaded());
    const promise = serveLlmsIndex(
      'llms',
      runtime(Array.from({ length: 51 }, (_, index) => `/p-${index}`), 50),
      fetcher,
    );
    await expect(promise).rejects.toBeInstanceOf(RuntimeCorpusLimitError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('owned artifacts are removed before the limit is applied', async () => {
    const fetcher = vi.fn(async () => loaded(''));
    await expect(
      serveLlmsIndex('llms', runtime(['/llms.txt'], 1), fetcher),
    ).resolves.toContain('# example.com');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('the concurrency helper never exceeds four workers', async () => {
    let active = 0;
    let peak = 0;
    await collectConcurrently(
      Array.from({ length: 20 }, (_, index) => String(index)),
      4,
      async (item) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return item;
      },
    );
    expect(peak).toBe(4);
  });

  test('runtime catalogs preserve authored Markdown after rendering the application route', async () => {
    const fetcher = vi.fn(async () => loaded());
    const catalog = {
      listPages(context) {
        expect(context.siteUrl).toBe('https://example.com');
        return [{ pathname: '/dynamic', title: 'Dynamic', markdown: '# Exact dynamic source' }];
      },
    };
    const body = await serveLlmsIndex('llms-full', runtime([], 50), fetcher, { catalogs: [catalog] });
    expect(body).toContain('# Dynamic');
    expect(body).toContain('# Exact dynamic source');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/dynamic');
  });

  test('catalog source is never published when the application route rejects the request', async () => {
    const response = new Response(html('Denied'), {
      status: 401,
      headers: { 'content-type': 'text/html' },
    });
    const fetcher = vi.fn(async () => ({ html: await response.clone().text(), response }));
    const catalog = {
      listPages: () => [{ pathname: '/private', title: 'Private', markdown: '# Protected source' }],
    };
    const body = await serveLlmsIndex('llms-full', runtime([], 50), fetcher, { catalogs: [catalog] });
    expect(fetcher).toHaveBeenCalledWith('/private');
    expect(body).not.toContain('Protected source');
  });

  test('an owned artifact listed by a runtime catalog is excluded before rendering', async () => {
    const fetcher = vi.fn(async () => loaded());
    const catalog = { listPages: () => [{ pathname: '/llms.txt', markdown: '# recursive' }] };
    const body = await serveLlmsIndex('llms', runtime([], 1), fetcher, { catalogs: [catalog] });
    expect(body).not.toContain('recursive');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(['/../secret', '/%2e%2e/secret', '/safe\\..\\secret'])(
    'an unsafe runtime catalog path is ignored: %s',
    async (pathname) => {
      const fetcher = vi.fn(async () => loaded());
      const catalog = { listPages: () => [{ pathname, markdown: '# Secret' }] };
      const body = await serveLlmsIndex('llms-full', runtime([], 1), fetcher, { catalogs: [catalog] });
      expect(body).not.toContain('Secret');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('serveMarkdown', () => {
  test('returns the upstream response with the representation', async () => {
    const source = new Response(html('About'), {
      status: 404,
      headers: { 'content-type': 'text/html', 'cache-control': 'private' },
    });
    const result = await serveMarkdown('/about.md', runtime(), async () => ({
      html: await source.clone().text(),
      response: source,
    }));
    expect(result.body).toContain('# About');
    expect(result.source?.status).toBe(404);
    expect(result.source?.headers.get('cache-control')).toBe('private');
  });

  test('uses a matching catalog descriptor only after the application route succeeds', async () => {
    const fetcher = vi.fn(async () => loaded(html('Rendered Dynamic')));
    const catalog = {
      listPages: () => [{ pathname: '/dynamic', title: 'Catalog Dynamic', markdown: '# Exact source' }],
    };
    const result = await serveMarkdown('/dynamic.md', runtime(), fetcher, { catalogs: [catalog] });
    expect(fetcher).toHaveBeenCalledWith('/dynamic');
    expect(result.body).toContain('# Exact source');
    expect(result.body).not.toContain('Rendered Dynamic');
  });

  test('does not expose a catalog descriptor through an HTML authorization error', async () => {
    const denied = new Response(html('Denied'), {
      status: 401,
      headers: { 'content-type': 'text/html' },
    });
    const catalog = { listPages: () => [{ pathname: '/private', markdown: '# Protected source' }] };
    const result = await serveMarkdown(
      '/private.md',
      runtime(),
      async () => ({ html: await denied.clone().text(), response: denied }),
      { catalogs: [catalog] },
    );
    expect(result.source?.status).toBe(401);
    expect(result.body).toContain('# Denied');
    expect(result.body).not.toContain('Protected source');
  });

  test('does not expose standalone or marker source through an HTML error', async () => {
    const deniedHtml = html('Denied').replace(
      '<main>',
      '<main><script data-astro-aeo-marker type="application/vnd.astro-aeo+json">{"markdown":"# Marker secret"}</script>',
    );
    const denied = new Response(deniedHtml, {
      status: 401,
      headers: { 'content-type': 'text/html' },
    });
    const protectedRuntime = runtime();
    protectedRuntime.standaloneSources['/private'] = {
      markdown: '# Standalone secret',
      path: 'src/pages/private.md',
    };
    const result = await serveMarkdown(
      '/private.md',
      protectedRuntime,
      async () => ({ html: deniedHtml, response: denied }),
    );
    expect(result.source?.status).toBe(401);
    expect(result.body).toContain('# Denied');
    expect(result.body).not.toMatch(/Marker secret|Standalone secret/);
  });
});
