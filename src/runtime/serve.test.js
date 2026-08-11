import { describe, expect, test, vi } from 'vitest';
import { resolveConfig } from '../config.js';
import {
  collectConcurrently,
  enrichRuntimePageGraph,
  pageFromHtml,
  renderStandaloneArtifact,
  RuntimeCorpusLimitError,
  RuntimeSchemaCorpusError,
  serveLlmsIndex,
  serveMarkdown,
  serveSchemaCorpus,
} from './serve.js';
import mdxRenderer from '../adapters/mdx.js';

const html = (title = 'Page') =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;

const runtime = (staticPaths = [], maxPages = 50) => ({
  command: 'dev',
  config: resolveConfig({ corpus: { runtime: { maxPages } } }),
  site: { siteUrl: 'https://example.com', base: '', trailingSlash: 'ignore' },
  staticPaths,
  projectPaths: staticPaths,
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

describe('request-time Markdown renderers', () => {
  test('uses the same raw MDX renderer path at runtime and caches its literal import', async () => {
    const mdxRuntime = runtime();
    mdxRuntime.standaloneSources['/interactive'] = {
      kind: 'mdx',
      body: '# Runtime MDX\n\n<Callout>**Mapped**</Callout>',
      path: 'src/pages/interactive.mdx',
    };
    const load = vi.fn(async () => mdxRenderer);
    const rendererLoaders = [{
      name: 'astro-aeo/mdx',
      module: 'astro-aeo/mdx',
      options: { components: { Callout: { action: 'unwrap' } } },
      load,
    }];

    const first = await pageFromHtml('/interactive', html('Rendered'), mdxRuntime, {
      rendererLoaders,
    });
    const second = await pageFromHtml('/interactive', html('Rendered'), mdxRuntime, {
      rendererLoaders,
    });
    expect(first.markdown).toBe('# Runtime MDX\n\n**Mapped**');
    expect(first.extraction).toMatchObject({ strategy: 'renderer:astro-aeo/mdx' });
    expect(second.markdown).toBe(first.markdown);
    expect(load).toHaveBeenCalledOnce();
  });

  test('preserves catalog source hashes in renderer input and page provenance', async () => {
    const render = vi.fn(({ source }) => {
      expect(source).toEqual({
        kind: 'cms',
        path: 'cms:guide',
        body: '# CMS body',
        hash: 'sha256:catalog-source',
      });
      return { status: 'rendered', markdown: '# Rendered CMS' };
    });
    const result = await pageFromHtml('/guide', html('Guide'), runtime(), {
      descriptor: {
        pathname: '/guide',
        source: {
          kind: 'cms',
          path: 'cms:guide',
          body: '# CMS body',
          hash: 'sha256:catalog-source',
        },
      },
      rendererLoaders: [{
        name: 'cms-renderer',
        module: './cms-renderer.js',
        load: async () => ({ name: 'cms-renderer', apiVersion: 1, render }),
      }],
    });

    expect(render).toHaveBeenCalledOnce();
    expect(result.source).toMatchObject({
      kind: 'cms',
      path: 'cms:guide',
      hash: 'sha256:catalog-source',
    });
  });
});

describe('request-time catalog breadcrumb ancestry', () => {
  const catalog = {
    listPages: () => [
      { pathname: '/', title: 'Catalog home' },
      { pathname: '/guides', title: 'Catalog guides' },
      { pathname: '/guides/install', title: 'Catalog install' },
    ],
  };

  test('enriches a direct runtime page from the complete configured catalog chain', async () => {
    const pageRuntime = runtime();
    const page = await pageFromHtml('/guides/install', html('Rendered install'), pageRuntime);
    const enriched = await enrichRuntimePageGraph(html('Rendered install'), page, pageRuntime, {
      catalogLoaders: [catalogLoader(catalog)],
    });

    expect(enriched.html).toContain('BreadcrumbList');
    expect(enriched.html).toContain('"name":"Catalog home"');
    expect(enriched.html).toContain('"name":"Catalog guides"');
    expect(enriched.html).toContain('"name":"Catalog install"');
  });

  test('uses the same catalog ancestry while collecting the runtime schema corpus', async () => {
    const corpusRuntime = runtime();
    corpusRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const result = await serveSchemaCorpus(
      'schema-graph',
      corpusRuntime,
      async (pathname) => loaded(html(pathname)),
      { catalogLoaders: [catalogLoader(catalog)] },
    );

    expect(result.body).toContain('BreadcrumbList');
    expect(result.body).toContain('"name":"Catalog home"');
    expect(result.body).toContain('"name":"Catalog guides"');
    expect(result.body).toContain('"name":"Catalog install"');
  });
});

describe('request-time plugin page lifecycle', () => {
  test('keeps encoded catalog identity and ISO dates stable through discovery', async () => {
    const observed = [];
    const pluginLoaders = [{
      name: 'encoded-catalog',
      module: './encoded-catalog.js',
      stages: ['page:discovered'],
      claims: [],
      load: async () => ({
        name: 'encoded-catalog',
        apiVersion: 1,
        setup(api) {
          api.on('page:discovered', ({ value, pathname }) => {
            observed.push({ valuePathname: value.pathname, pathname });
            return { action: 'replace', value: { ...value, title: 'Encoded catalog' } };
          });
        },
      }),
    }];
    const page = await pageFromHtml('/café', html('Rendered'), runtime(), {
      descriptor: {
        pathname: '/caf%C3%A9',
        dates: { published: '2026-08-11' },
      },
      publicPathname: '/caf%C3%A9',
      pluginLoaders,
    });

    expect(observed).toEqual([{
      valuePathname: '/caf%C3%A9',
      pathname: '/caf%C3%A9',
    }]);
    expect(page).toMatchObject({
      pathname: '/caf%C3%A9',
      title: 'Encoded catalog',
      dates: { published: '2026-08-11T00:00:00.000Z' },
    });
  });

  test('runs page hooks in order with immutable validated replacements before the graph hook', async () => {
    const stages = [];
    const pluginLoaders = [{
      name: 'runtime-pages',
      module: './runtime-pages.js',
      stages: ['page:discovered', 'page:extract', 'page:transform', 'page:metadata', 'graph:build'],
      claims: [],
      load: async () => ({
        name: 'runtime-pages',
        apiVersion: 1,
        setup(api) {
          expect(api.command).toBe('dev');
          api.on('page:discovered', ({ value }) => {
            stages.push('page:discovered');
            expect(Object.isFrozen(value)).toBe(true);
            return { action: 'replace', value: { ...value, title: 'Discovered' } };
          });
          api.on('page:extract', ({ value }) => {
            stages.push('page:extract');
            expect(Object.isFrozen(value.representations)).toBe(true);
            return {
              action: 'replace',
              value: {
                ...value,
                representations: { ...value.representations, markdown: '# Extracted' },
              },
            };
          });
          api.on('page:transform', ({ value }) => {
            stages.push('page:transform');
            return {
              action: 'replace',
              value: {
                ...value,
                title: 'Transformed',
                metadata: { ...value.metadata, title: 'Transformed' },
              },
            };
          });
          api.on('page:metadata', ({ value }) => {
            stages.push('page:metadata');
            return {
              action: 'replace',
              value: { ...value, title: 'Metadata' },
              diagnostics: [{ code: 'RUNTIME NOTE', message: 'kept\non one line' }],
            };
          });
          api.on('graph:build', ({ value }) => {
            stages.push('graph:build');
            expect(value.graph.entries.length).toBeGreaterThan(0);
            return {
              action: 'replace',
              value: { ...value, html: value.html.replace('</head>', '<meta name="plugin" content="yes"></head>') },
            };
          });
        },
      }),
    }];
    const pageRuntime = runtime();
    const page = await pageFromHtml('/plugin-page', html('Rendered'), pageRuntime, { pluginLoaders });

    expect(page.title).toBe('Metadata');
    expect(page.markdown).toBe('# Extracted');
    expect(page.diagnostics).toContainEqual(expect.objectContaining({
      code: 'runtime-note',
      message: 'Plugin "runtime-pages" reported runtime-note during page:metadata.',
      details: { plugin: 'runtime-pages', stage: 'page:metadata' },
    }));

    const enriched = await enrichRuntimePageGraph(html('Rendered'), page, pageRuntime, { pluginLoaders });
    expect(enriched.isolated).toBe(false);
    expect(enriched.html).toContain('<meta name="plugin" content="yes">');
    expect(stages).toEqual([
      'page:discovered',
      'page:extract',
      'page:transform',
      'page:metadata',
      'graph:build',
    ]);
  });

  test('isolates invalid page replacements and graph failures without exposing thrown values', async () => {
    const invalidPageLoaders = [{
      name: 'invalid-page',
      module: './invalid-page.js',
      stages: ['page:transform'],
      claims: [],
      load: async () => ({
        name: 'invalid-page', apiVersion: 1,
        setup(api) {
          api.on('page:transform', ({ value }) => ({
            action: 'replace',
            value: { ...value, id: '/different' },
          }));
        },
      }),
    }];
    await expect(pageFromHtml('/page', html(), runtime(), { pluginLoaders: invalidPageLoaders }))
      .resolves.toBeNull();

    const invalidRepresentationsLoaders = [{
      name: 'invalid-representations',
      module: './invalid-representations.js',
      stages: ['page:transform'],
      claims: [],
      load: async () => ({
        name: 'invalid-representations', apiVersion: 1,
        setup(api) {
          api.on('page:transform', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              markdown: 42,
              representations: { ...value.representations, markdown: 42 },
            },
          }));
        },
      }),
    }];
    await expect(pageFromHtml('/page', html(), runtime(), {
      pluginLoaders: invalidRepresentationsLoaders,
    })).resolves.toBeNull();

    const graphLoaders = [{
      name: 'broken-graph',
      module: './broken-graph.js',
      stages: ['graph:build'],
      claims: [],
      load: async () => ({
        name: 'broken-graph', apiVersion: 1,
        setup(api) {
          api.on('graph:build', () => { throw new Error('SECRET GRAPH PAYLOAD'); });
        },
      }),
    }];
    const graphRuntime = runtime();
    const page = await pageFromHtml('/page', html(), graphRuntime, { pluginLoaders: graphLoaders });
    const enriched = await enrichRuntimePageGraph(html(), page, graphRuntime, { pluginLoaders: graphLoaders });
    expect(enriched.isolated).toBe(true);
    expect(enriched.html).toBe(html());
    expect(enriched.html).not.toContain('SECRET GRAPH PAYLOAD');
    expect(enriched.diagnostics.at(-1)).toMatchObject({
      code: 'plugin-hook-failed',
      details: { plugin: 'broken-graph', stage: 'graph:build' },
    });
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

  test('request-time corpus collection is serial by default', async () => {
    let active = 0;
    let peak = 0;
    await serveLlmsIndex('llms', runtime(['/first', '/second', '/third']), async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return loaded();
    });
    expect(peak).toBe(1);
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

  test('deduplicates encoded percent catalog paths against decoded project routes', async () => {
    const fetcher = vi.fn(async () => loaded(html('Rendered sale')));
    const catalog = {
      listPages: () => [{
        pathname: '/sale-100%25',
        title: 'Catalog sale',
        markdown: '# Exact percent source',
      }],
    };
    const body = await serveLlmsIndex(
      'llms-full',
      runtime(['/sale-100%'], 50),
      fetcher,
      { catalogLoaders: [catalogLoader(catalog)] },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/sale-100%25');
    expect(body).toContain('# Exact percent source');
    expect(body).toContain('URL: https://example.com/sale-100%25/');
    expect(body).not.toContain('# Rendered sale');
  });

  test('does not decode literal percent escapes in canonical runtime paths twice', async () => {
    const fetcher = vi.fn(async () => loaded(html('Rendered escaped name')));
    const catalog = {
      listPages: () => [{
        pathname: '/escaped%2520name',
        title: 'Catalog escaped name',
        markdown: '# Exact escaped source',
      }],
    };
    const body = await serveLlmsIndex(
      'llms-full',
      runtime(['/escaped%20name'], 50),
      fetcher,
      { catalogLoaders: [catalogLoader(catalog)] },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/escaped%2520name');
    expect(body).toContain('# Exact escaped source');
    expect(body).toContain('URL: https://example.com/escaped%2520name/');
    expect(body).not.toContain('# Rendered escaped name');
  });

  test('cancels an unread corpus response when its bytes cannot be transformed', async () => {
    const source = new Response('encoded bytes', {
      headers: {
        'content-encoding': 'gzip',
        'content-type': 'text/html',
      },
    });
    const cancel = vi.spyOn(source.body, 'cancel').mockResolvedValue();
    const body = await serveLlmsIndex('llms-full', runtime(['/encoded']), async () => ({
      html: null,
      response: source,
    }));

    expect(body).not.toContain('encoded bytes');
    expect(cancel).toHaveBeenCalledOnce();
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

describe('request-time schema corpus', () => {
  test('renders a deterministic graph and XML map from anonymous serial rewrites', async () => {
    const schemaRuntime = runtime(['/zeta', '/alpha']);
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const fetcher = vi.fn(async (pathname) => loaded(html(pathname.slice(1))));

    const graph = await serveSchemaCorpus('schema-graph', schemaRuntime, fetcher);
    const map = await serveSchemaCorpus('schema-map', schemaRuntime, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(graph.contentType).toBe('application/ld+json; charset=utf-8');
    expect(graph.body).toContain('"@id":"https://example.com/alpha/#webpage"');
    expect(graph.body.indexOf('/alpha/#webpage')).toBeLessThan(graph.body.indexOf('/zeta/#webpage'));
    expect(map.contentType).toBe('application/xml; charset=utf-8');
    expect(map.body).toContain('xmlns="https://zaai.com/astro-aeo/schema-map/1"');
    expect(map.body).toContain('graph="https://example.com/schema/graph.jsonld"');
  });

  test('requires a stable configured site rather than a request origin', async () => {
    const schemaRuntime = runtime(['/page']);
    schemaRuntime.site.siteUrl = '';
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });

    await expect(
      serveSchemaCorpus('schema-graph', schemaRuntime, async () => loaded(), {
        origin: 'https://request-host.example',
      }),
    ).rejects.toBeInstanceOf(RuntimeSchemaCorpusError);
  });

  test('does not recursively collect either owned schema corpus path', async () => {
    const schemaRuntime = runtime(['/schema/graph.jsonld', '/schema/schema-map.xml'], 1);
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const fetcher = vi.fn(async () => loaded());

    const graph = await serveSchemaCorpus('schema-graph', schemaRuntime, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(graph.body).toContain('"@graph":[]');
  });

  test('fails closed when corpus-dependent authored JSON-LD is malformed', async () => {
    const schemaRuntime = runtime(['/page']);
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });

    await expect(serveSchemaCorpus(
      'schema-graph',
      schemaRuntime,
      async () => loaded(html('Page').replace(
        '</head>',
        '<script type="application/ld+json">{"@type":"Thing",}</script></head>',
      )),
    )).rejects.toBeInstanceOf(RuntimeSchemaCorpusError);
  });
});

describe('serveMarkdown', () => {

  test('matches encoded catalog descriptors to a decoded percent request path', async () => {
    const fetcher = vi.fn(async () => loaded(html('Rendered sale')));
    const result = await serveMarkdown('/sale-100%.md', runtime(), fetcher, {
      catalogLoaders: [catalogLoader({
        listPages: () => [{ pathname: '/sale-100%25', markdown: '# Exact percent source' }],
      })],
      publicPathname: '/sale-100%25',
    });

    expect(fetcher).toHaveBeenCalledWith('/sale-100%25');
    expect(result.body).toContain('# Exact percent source');
    expect(result.body).not.toContain('# Rendered sale');
  });

  test('matches a once-decoded literal escape without decoding it again', async () => {
    const fetcher = vi.fn(async () => loaded(html('Rendered escaped name')));
    const result = await serveMarkdown('/escaped%20name.md', runtime(), fetcher, {
      catalogLoaders: [catalogLoader({
        listPages: () => [{
          pathname: '/escaped%2520name',
          markdown: '# Exact escaped source',
        }],
      })],
      publicPathname: '/escaped%2520name',
    });

    expect(fetcher).toHaveBeenCalledWith('/escaped%2520name');
    expect(result.body).toContain('# Exact escaped source');
    expect(result.body).not.toContain('# Rendered escaped name');
  });
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

  test('passes the effective request site to catalogs with a bounded last-origin cache', async () => {
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
    const repeatedFirst = await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://one.example',
    });
    const second = await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://two.example',
    });
    const third = await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://one.example',
    });

    expect(first).toContain('one.example');
    expect(repeatedFirst).toContain('one.example');
    expect(second).toContain('two.example');
    expect(third).toContain('one.example');
    expect(listPages).toHaveBeenCalledTimes(3);
  });

  test('uses one stable catalog cache entry when the site is configured', async () => {
    const requestRuntime = runtime([], 50);
    const listPages = vi.fn(() => [{ pathname: '/dynamic', markdown: '# Dynamic' }]);
    const loaders = [catalogLoader({ listPages })];

    await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://one.example',
    });
    await serveLlmsIndex('llms', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
      origin: 'https://two.example',
    });

    expect(listPages).toHaveBeenCalledOnce();
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

  test.each([
    [206, {}],
    [200, { 'content-encoding': 'gzip' }],
  ])('does not convert an untransformable source response (%s, %o)', async (status, headers) => {
    const source = new Response(html('Partial'), {
      status,
      headers: { 'content-type': 'text/html', ...headers },
    });
    const result = await serveMarkdown('/partial.md', runtime(), async () => ({
      html: html('Partial'),
      response: source,
    }));

    expect(result).toEqual({ body: null, source });
  });

  test('caches a rejected runtime catalog loader and warns once', async () => {
    const requestRuntime = runtime();
    const load = vi.fn(async () => {
      throw new Error('SECRET runtime-only failure');
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
    expect(warnings[0]).not.toContain('SECRET');
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
