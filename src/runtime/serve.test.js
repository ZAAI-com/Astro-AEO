import { describe, expect, test, vi } from 'vitest';
import { resolveConfig } from '../config.js';
import {
  collectConcurrently,
  renderStandaloneArtifact,
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

const catalogLoader = (catalog, module = './catalog.js') => ({
  module,
  load: async () => catalog,
});

describe('standalone robots rendering', () => {
  test.each([
    [true, true],
    [false, false],
  ])('advertises an auto sitemap when availability is %s', (sitemapAvailable, advertised) => {
    const robotsRuntime = runtime();
    robotsRuntime.config = resolveConfig({ discovery: { robots: { enabled: true } } });
    const { body } = renderStandaloneArtifact('robots', robotsRuntime, { sitemapAvailable });
    expect(body.includes('Sitemap: https://example.com/sitemap-index.xml')).toBe(advertised);
  });
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
    const body = await serveLlmsIndex('llms-full', runtime([], 50), fetcher, {
      catalogLoaders: [catalogLoader(catalog)],
    });
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
    const body = await serveLlmsIndex('llms-full', runtime([], 50), fetcher, {
      catalogLoaders: [catalogLoader(catalog)],
    });
    expect(fetcher).toHaveBeenCalledWith('/private');
    expect(body).not.toContain('Protected source');
  });

  test('an owned artifact listed by a runtime catalog is excluded before rendering', async () => {
    const fetcher = vi.fn(async () => loaded());
    const catalog = { listPages: () => [{ pathname: '/llms.txt', markdown: '# recursive' }] };
    const body = await serveLlmsIndex('llms', runtime([], 1), fetcher, {
      catalogLoaders: [catalogLoader(catalog)],
    });
    expect(body).not.toContain('recursive');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(['/../secret', '/%2e%2e/secret', '/safe\\..\\secret'])(
    'an unsafe runtime catalog path is ignored: %s',
    async (pathname) => {
      const fetcher = vi.fn(async () => loaded());
      const catalog = { listPages: () => [{ pathname, markdown: '# Secret' }] };
      const body = await serveLlmsIndex('llms-full', runtime([], 1), fetcher, {
        catalogLoaders: [catalogLoader(catalog)],
      });
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
    const result = await serveMarkdown('/dynamic.md', runtime(), fetcher, {
      catalogLoaders: [catalogLoader(catalog)],
    });
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
      { catalogLoaders: [catalogLoader(catalog)] },
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

  test('uses the request origin when Astro has no configured site', async () => {
    const requestRuntime = runtime();
    requestRuntime.site.siteUrl = '';
    requestRuntime.config = resolveConfig({ markdown: { frontmatter: true } });
    const source = html('About').replace(
      '</main>',
      '<a href="contact">Contact</a></main>',
    );
    const result = await serveMarkdown('/about.md', requestRuntime, async () => loaded(source), {
      origin: 'https://request.example',
    });

    expect(result.body).toContain('url: https://request.example/about');
    expect(result.body).toContain('[Contact](https://request.example/about/contact)');
  });

  test('keeps the configured site authoritative over the request origin', async () => {
    const source = html('About').replace(
      '</main>',
      '<a href="contact">Contact</a></main>',
    );
    const result = await serveMarkdown('/about.md', runtime(), async () => loaded(source), {
      origin: 'https://request.example',
    });

    expect(result.body).toContain('[Contact](https://example.com/about/contact)');
    expect(result.body).not.toContain('request.example');
  });

  test('passes the effective request site to catalogs and caches per origin', async () => {
    const requestRuntime = runtime([], 50);
    requestRuntime.site.siteUrl = '';
    const listPages = vi.fn(({ siteUrl }) => [{
      pathname: '/dynamic',
      title: new URL(siteUrl).hostname,
      markdown: '# Dynamic',
    }]);
    const loaders = [catalogLoader({ listPages })];

    const first = await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://one.example',
    });
    const second = await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://two.example',
    });

    expect(first).toContain('one.example');
    expect(second).toContain('two.example');
    expect(listPages).toHaveBeenCalledTimes(2);
  });

  test('passes bodyless source statuses through without conversion', async () => {
    for (const status of [204, 205]) {
      const response = new Response(null, {
        status,
        headers: { 'content-type': 'text/html', 'x-source': String(status) },
      });
      const result = await serveMarkdown('/empty.md', runtime(), async () => ({
        html: '<html><body><main>not served</main></body></html>',
        response,
      }));
      expect(result).toEqual({ body: null, source: response });
    }
  });

  test('caches a rejected runtime catalog loader and warns once', async () => {
    const requestRuntime = runtime();
    const load = vi.fn(async () => {
      throw new Error('runtime-only failure');
    });
    const loaders = [{ module: './runtime-broken.js', load }];
    const warnings = [];
    const warning = vi.spyOn(console, 'warn').mockImplementation((message) => {
      warnings.push(message);
    });
    try {
      await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
        catalogLoaders: loaders,
      });
      await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
        catalogLoaders: loaders,
      });
    } finally {
      warning.mockRestore();
    }

    expect(load).toHaveBeenCalledOnce();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('./runtime-broken.js');
  });
});

describe('request-origin standalone rendering', () => {
  test('uses the request origin for robots and the domain profile without Astro site', () => {
    const requestRuntime = runtime();
    requestRuntime.site.siteUrl = '';
    requestRuntime.config = resolveConfig({
      discovery: { robots: { enabled: true, sitemapPolicy: 'always' } },
      site: { profile: { enabled: true, name: 'Example' } },
    });

    const robots = renderStandaloneArtifact('robots', requestRuntime, {
      origin: 'https://request.example',
      sitemapAvailable: true,
    });
    const profile = renderStandaloneArtifact('domain-profile', requestRuntime, {
      origin: 'https://request.example',
    });

    expect(robots.body).toContain('https://request.example/sitemap-index.xml');
    expect(JSON.parse(profile.body).url).toBe('https://request.example');
  });
});
