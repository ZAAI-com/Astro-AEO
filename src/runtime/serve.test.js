import { describe, expect, test, vi } from 'vitest';
import { resolveConfig } from '../config.js';
import {
  buildRuntimePageInventory,
  collectConcurrently,
  enrichRuntimePageGraph,
  pageFromHtml,
  renderStandaloneArtifact,
  RuntimeCorpusCollectionError,
  RuntimeCorpusLimitError,
  RuntimeCorpusPlanError,
  runtimeArtifactOrigin,
  runtimeCatalogPagesFor,
  serveCorpusArtifact,
  RuntimeSchemaCorpusError,
  serveLlmsIndex,
  serveMarkdown,
  serveSchemaCorpus,
} from './serve.js';
import mdxRenderer from '../adapters/mdx.js';
import { createGraph } from '../schema.js';
import { createLocaleSnapshot } from '../core/locale.js';

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

test('serves versioned live corpora and archive manifests from the complete known inventory', async () => {
  const rt = runtime(['/guide', '/v1/guide']);
  rt.config = resolveConfig({ site: { defaultLocale: 'en' }, corpus: { versions: { current: 'v2', order: ['v1'] },
    manifest: { enabled: true }, chunks: { enabled: true } } });
  const descriptors = [{ pathname: '/guide', versionGroup: 'guide', markdown: '# Current' },
    { pathname: '/v1/guide', version: 'v1', versionGroup: 'guide', markdown: '# Archive' }];
  const opts = { catalogLoaders: [catalogLoader({ listPages: () => descriptors })] };
  const fetch = async (pathname) => loaded(html(pathname));
  const current = await serveCorpusArtifact('/llms-full.txt', rt, fetch, opts);
  expect(current.body).toContain('# Current');
  expect(current.body).not.toContain('# Archive');
  const archive = await serveCorpusArtifact('/v1/llms-full.txt', rt, fetch, opts);
  expect(archive.body).toContain('# Archive');
  expect(archive.body).not.toContain('# Current');
  const aggregate = JSON.parse((await serveCorpusArtifact('/llms/manifest.json', rt, fetch, opts)).body);
  const scoped = JSON.parse((await serveCorpusArtifact('/v1/llms/manifest.json', rt, fetch, opts)).body);
  expect(aggregate.pages).toHaveLength(2);
  expect(scoped.pages.every((page) => page.version === 'v1')).toBe(true);
  expect(aggregate.pages.every((page) => page.versionAlternates.length === 1)).toBe(true);
});

test('collects private marker versions before running each runtime page and graph hook once', async () => {
  const rt = runtime(['/guide', '/v1/guide']);
  rt.config = resolveConfig({ site: { defaultLocale: 'en' }, corpus: { versions: { current: 'v2' }, manifest: { enabled: true } } });
  const observed = [];
  const pluginLoaders = [{ name: 'version-markers', module: './version-markers.js',
    stages: ['page:transform', 'graph:build'], claims: [], load: async () => ({ name: 'version-markers', apiVersion: 1,
      setup(api) {
        api.on('page:transform', ({ value }) => {
          observed.push(['transform', value.version, value.alternates]);
          expect('_generatedVersionAlternates' in value).toBe(false);
        });
        api.on('graph:build', ({ value }) => {
          observed.push(['graph', value.page.version, value.page.alternates]);
          expect('_generatedVersionAlternates' in value.page).toBe(false);
        });
      },
    }),
  }];
  const fetch = async (pathname) => {
    const version = pathname.startsWith('/v1/') ? 'v1' : 'v2';
    const marker = { version, versionGroup: 'guide', markdown: `# ${version}` };
    return loaded(html(version).replace('</head>', `<script data-astro-aeo-marker type="application/vnd.astro-aeo+json">${JSON.stringify(marker)}</script></head>`));
  };
  const result = await serveCorpusArtifact('/llms/manifest.json', rt, fetch, { pluginLoaders });
  expect(JSON.parse(result.body).pages).toHaveLength(2);
  expect(observed.map((entry) => entry.slice(0, 2))).toEqual([
    ['transform', 'v2'], ['graph', 'v2'], ['transform', 'v1'], ['graph', 'v1'],
  ]);
  expect(observed.every((entry) => entry[2].length === 1 && entry[2][0].kind === 'version')).toBe(true);
});

/** Let a background catalog refresh settle and merge. */
const settle = () => new Promise((resolve) => setTimeout(resolve));
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

  test('computes catalog source hashes in renderer input and page provenance', async () => {
    const render = vi.fn(({ source }) => {
      expect(source).toEqual({
        kind: 'cms',
        path: 'cms:guide',
        body: '# CMS body',
        hash: 'sha256:31867d075b4268f5066819b48c835131cab131971a061b2765908332d807846a',
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
      hash: 'sha256:31867d075b4268f5066819b48c835131cab131971a061b2765908332d807846a',
    });
  });

  test('ignores a truthy non-array catalog alternates value', async () => {
    const result = await pageFromHtml('/guide', html('Guide'), runtime(), {
      descriptor: { pathname: '/guide', alternates: 'https://example.com/en/' },
    });

    expect(result).not.toBeNull();
    expect(result.alternates).toBeUndefined();
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

  test('reconciles graph-only runtime replacements and preserves authored JSON-LD', async () => {
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","@id":"#author","name":"Authored"}</script>';
    const source = `<!doctype html><html><head><title>Page</title>${authoredScript}</head><body><main>Page</main></body></html>`;
    const pluginLoaders = [{
      name: 'managed-runtime-replacement',
      module: './managed-runtime-replacement.js',
      stages: ['graph:build'],
      claims: [],
      load: async () => ({
        name: 'managed-runtime-replacement',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              graph: createGraph([{
                '@id': 'https://example.com/page#replacement',
                '@type': 'Thing',
                name: 'Runtime managed replacement',
              }]),
            },
          }));
        },
      }),
    }];
    const pageRuntime = runtime();
    const page = await pageFromHtml('/page', source, pageRuntime, { pluginLoaders });
    const enriched = await enrichRuntimePageGraph(source, page, pageRuntime, { pluginLoaders });

    expect(enriched.isolated).toBe(false);
    expect(enriched.html).toContain(authoredScript);
    expect(enriched.html).toContain('Runtime managed replacement');
    expect(enriched.html.match(/"name":"Authored"/g)).toHaveLength(1);
  });

  test('derives runtime managed output from normalized-only replacements', async () => {
    const pluginLoaders = [{
      name: 'normalized-runtime-replacement',
      module: './normalized-runtime-replacement.js',
      stages: ['graph:build'],
      claims: [],
      load: async () => ({
        name: 'normalized-runtime-replacement',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              normalizedGraph: createGraph([
                ...value.normalizedGraph.entries,
                {
                  '@id': 'https://example.com/page#faq',
                  '@type': 'FAQPage',
                  name: 'Runtime normalized replacement',
                },
              ]),
            },
          }));
        },
      }),
    }];
    const pageRuntime = runtime();
    const source = html();
    const page = await pageFromHtml('/page', source, pageRuntime, { pluginLoaders });
    const enriched = await enrichRuntimePageGraph(source, page, pageRuntime, { pluginLoaders });

    expect(enriched.isolated).toBe(false);
    expect(enriched.html).toContain('Runtime normalized replacement');
    expect(enriched.graph.entries.some(({ entity }) => entity.name === 'Runtime normalized replacement'))
      .toBe(true);
  });

  test('isolates inconsistent runtime graph replacements without exposing values', async () => {
    const pluginLoaders = [{
      name: 'inconsistent-runtime-graphs',
      module: './inconsistent-runtime-graphs.js',
      stages: ['graph:build'],
      claims: [],
      load: async () => ({
        name: 'inconsistent-runtime-graphs',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              graph: createGraph([{
                '@id': 'https://example.com/page#secret-managed',
                '@type': 'Thing',
                name: 'SECRET MANAGED VALUE',
              }]),
              normalizedGraph: createGraph([{
                '@id': 'https://example.com/page#different',
                '@type': 'Thing',
                name: 'SECRET NORMALIZED VALUE',
              }]),
            },
          }));
        },
      }),
    }];
    const pageRuntime = runtime();
    const source = html();
    const page = await pageFromHtml('/page', source, pageRuntime, { pluginLoaders });
    const enriched = await enrichRuntimePageGraph(source, page, pageRuntime, { pluginLoaders });

    expect(enriched.isolated).toBe(true);
    expect(enriched.html).toBe(source);
    expect(enriched.diagnostics).toContainEqual(expect.objectContaining({
      code: 'plugin-graph-inconsistent',
      severity: 'error',
      pathname: '/page',
    }));
    expect(JSON.stringify(enriched)).not.toContain('SECRET');
  });

  test('retains inspect-only authored diagnostics once when graph hooks run', async () => {
    const pluginLoaders = [{
      name: 'inspect-authored',
      module: './inspect-authored.js',
      stages: ['graph:build'],
      claims: [],
      load: async () => ({
        name: 'inspect-authored',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', () => ({ action: 'keep' }));
        },
      }),
    }];
    const pageRuntime = runtime();
    pageRuntime.config = resolveConfig({
      schema: { autoInject: false, corpus: { enabled: false } },
    });
    const source = '<!doctype html><html><head>' +
      '<title>Page</title><title>Page</title>' +
      '<script type="application/ld+json">{"@type":"Thing",}</script>' +
      '</head><body><main>Page</main></body></html>';
    const page = await pageFromHtml('/page', source, pageRuntime, { pluginLoaders });

    const enriched = await enrichRuntimePageGraph(source, page, pageRuntime, { pluginLoaders });

    expect(enriched.isolated).toBe(false);
    expect(enriched.graph).toBeNull();
    expect(enriched.diagnostics.filter(({ code }) => code === 'authored-jsonld-malformed'))
      .toHaveLength(1);
    expect(enriched.diagnostics.filter(({ code }) => code === 'metadata-duplicate'))
      .toHaveLength(1);
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

describe('production corpus collection completeness', () => {
  const collectors = [
    ['text', (state, fetcher) => serveCorpusArtifact('/llms-full.txt', state, fetcher)],
    ['graph', (state, fetcher) => serveSchemaCorpus('schema-graph', state, fetcher)],
    ['map', (state, fetcher) => serveSchemaCorpus('schema-map', state, fetcher)],
  ];
  const unavailable = [
    ['thrown transport', () => { throw new Error('SECRET transport failure'); }],
    ['null transport', () => null],
    ['HTML server error', () => ({ html: html('SECRET error'), response: new Response('SECRET', { status: 500, headers: { 'content-type': 'text/html' } }) })],
    ['non-HTML server error', () => ({ html: null, response: new Response('SECRET', { status: 503 }) })],
    ['not-modified source', () => ({ html: null, response: new Response(null, { status: 304 }) })],
    ['partial HTML', () => ({ html: html('SECRET partial'), response: new Response('SECRET', { status: 206, headers: { 'content-type': 'text/html' } }) })],
    ['encoded HTML', () => ({ html: null, response: new Response('SECRET', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }) })],
    ['unsupported charset', () => ({ html: html('SECRET legacy'), response: new Response('SECRET', { headers: { 'content-type': 'text/html; charset=windows-1252' } }) })],
    ['malformed charset', () => ({ html: null, response: new Response('SECRET', { headers: { 'content-type': 'text/html; charset=' } }) })],
    ['malformed duplicate charset', () => ({ html: html(), response: new Response('SECRET', { headers: { 'content-type': 'text/html; charset=utf-8; charset=' } }) })],
    ['malformed quoted charset', () => ({ html: html(), response: new Response('SECRET', { headers: { 'content-type': 'text/html; charset="utf-8"junk' } }) })],
    ['missing HTML', () => ({ html: null, response: new Response('SECRET', { headers: { 'content-type': 'text/html' } }) })],
    ['empty HTML', () => ({ html: '', response: new Response(null, { headers: { 'content-type': 'text/html' } }) })],
    ['blank HTML', () => ({ html: ' \n\t', response: new Response(' \n\t', { headers: { 'content-type': 'text/html' } }) })],
  ];

  for (const command of ['build', 'preview']) {
    describe.each(collectors)(`${command} %s collection`, (_kind, collect) => {
      test.each(unavailable)('rejects %s after a healthy page', async (_label, fail) => {
        const state = { ...runtime(['/a-healthy', '/z-failing']), command };
        const fetcher = vi.fn(async (pathname) => pathname === '/a-healthy' ? loaded(html('Healthy page')) : fail());
        await expect(collect(state, fetcher)).rejects.toMatchObject({
          name: 'RuntimeCorpusCollectionError',
          message: 'astro-aeo: runtime corpus collection is incomplete.',
        });
        expect(fetcher.mock.calls.map(([pathname]) => pathname)).toEqual(['/a-healthy', '/z-failing']);
      });

      test.each([200, 204, 205, 206, 301, 302, 307, 308, 400, 401, 403, 404, 410, 429])(
        'keeps intentional status %s exclusions', async (status) => {
          const body = [204, 205].includes(status) ? null : 'Excluded page';
          const response = new Response(body, {
            status,
            headers: status >= 300 && status < 400 ? { location: '/login' } : {},
          });
          const state = { ...runtime(['/a-healthy', '/z-excluded']), command };
          const result = await collect(state, async (pathname) =>
            pathname === '/a-healthy' ? loaded(html('Healthy page')) : { html: null, response });
          expect(result.body).toContain('a-healthy');
          expect(result.body).not.toContain('z-excluded');
        },
      );

      test.each([
        '<meta name="robots" content="noindex">',
        '<meta name="aeo" content="skip">',
      ])('preserves successful page exclusions: %s', async (marker) => {
        const state = { ...runtime(['/a-healthy', '/z-excluded']), command };
        const result = await collect(state, async (pathname) => loaded(
          pathname === '/a-healthy' ? html('Healthy page') : html('Excluded page').replace('</head>', `${marker}</head>`),
        ));
        expect(result.body).toContain('a-healthy');
        expect(result.body).not.toContain('z-excluded');
      });
    });
  }

  test('cancels unread production HTML before rejecting its collection', async () => {
    const response = new Response('encoded source', {
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
    });
    const cancel = vi.spyOn(response.body, 'cancel').mockResolvedValue();
    await expect(serveCorpusArtifact('/llms.txt', { ...runtime(['/page']), command: 'build' }, async () => ({ html: null, response })))
      .rejects.toBeInstanceOf(RuntimeCorpusCollectionError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('retains development null-render exclusions and thrown transport errors', async () => {
    expect((await serveCorpusArtifact('/llms-full.txt', runtime(['/page']), async () => null)).body)
      .toBe('# example.com\n\n---\n');
    const failure = new Error('development transport error');
    await expect(serveCorpusArtifact('/llms-full.txt', runtime(['/page']), async () => { throw failure; }))
      .rejects.toBe(failure);
  });

  test.each(collectors)('uses the catalog lifecycle spelling for %s configuration exclusions', async (_kind, collect) => {
    const state = { ...runtime(['/sale 100%']), command: 'build' };
    state.config = resolveConfig({ pages: { exclude: ['/sale%20100%25'] } });
    const fetcher = vi.fn(async () => { throw new Error('Excluded page must not render'); });
    const options = { catalogLoaders: [catalogLoader({
      listPages: () => [{ pathname: '/sale%20100%25', markdown: '# Exact source' }],
    })] };
    if (_kind === 'text') await serveCorpusArtifact('/llms-full.txt', state, fetcher, options);
    else await serveSchemaCorpus(_kind === 'graph' ? 'schema-graph' : 'schema-map', state, fetcher, options);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(['build', 'preview'])('rejects an incomplete %s corpus after a healthy page', async (command) => {
    const requestRuntime = { ...runtime(['/a-healthy', '/z-failing']), command };
    await expect(serveCorpusArtifact('/llms-full.txt', requestRuntime, async (pathname) =>
      pathname === '/a-healthy' ? loaded(html('Healthy page')) : null,
    )).rejects.toMatchObject({ name: 'RuntimeCorpusCollectionError' });
  });
});

describe('request-time corpus manifest', () => {
  test('lists the .md companion, token count and hash the middleware serves', async () => {
    const requestRuntime = runtime(['/guide', '/private']);
    requestRuntime.config = resolveConfig({ corpus: { manifest: { enabled: true } } });
    const fetcher = async (pathname) => loaded(pathname === '/private'
      ? html('Private').replace('</head>', '<meta name="aeo" content="no-dotmd"></head>')
      : html('Guide'));

    const manifest = await serveCorpusArtifact('/llms/manifest.json', requestRuntime, fetcher);
    const pages = JSON.parse(manifest.body).pages;
    const guide = pages.find((page) => page.id === '/guide');
    const opted = pages.find((page) => page.id === '/private');
    expect(guide.markdownUrl).toBe('https://example.com/guide.md');
    expect(guide.tokenCount).toEqual(expect.any(Number));
    expect(guide.hash).toMatch(/^sha256:/);
    expect(opted).toMatchObject({ markdownUrl: null, tokenCount: null });
    // The middleware serves the companion the manifest now lists.
    expect(await serveMarkdown('/guide.md', requestRuntime, fetcher)).not.toBeNull();
  });
});

describe('locale-aware request-time corpus planning', () => {
  test('serves locale families, chunks, and the manifest from one semantic plan', async () => {
    const requestRuntime = runtime(['/en/guide', '/fr/guide'], 50);
    requestRuntime.config = resolveConfig({
      corpus: {
        small: { enabled: true, maxTokens: 1_000 },
        chunks: { enabled: true, maxTokensPerFile: 1_000 },
        manifest: { enabled: true },
      },
    });
    requestRuntime.site.i18n = createLocaleSnapshot({
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      routing: { prefixDefaultLocale: true },
    }, requestRuntime.site.siteUrl);
    const fetcher = async (pathname) => loaded(
      html(pathname).replace('<html>', `<html lang="${pathname.startsWith('/fr') ? 'fr' : 'en'}">`),
    );

    const root = await serveCorpusArtifact('/llms.txt', requestRuntime, fetcher);
    const french = await serveCorpusArtifact('/fr/llms-full.txt', requestRuntime, fetcher);
    const manifest = await serveCorpusArtifact('/llms/manifest.json', requestRuntime, fetcher);
    const parsed = JSON.parse(manifest.body);

    expect(root.body).toContain('## Languages');
    expect(french.body).toContain('URL: https://example.com/fr/guide/');
    expect(french.body).not.toContain('/en/guide/');
    expect(parsed.locales.map(({ locale }) => locale)).toEqual(['en', 'fr']);
    expect(parsed.artifacts.some(({ pathname }) => pathname.startsWith('/fr/llms/'))).toBe(true);
    expect(manifest.contentType).toBe('application/json; charset=utf-8');
  });

  test('selects configured domain origins exactly and rejects unknown hosts', async () => {
    const requestRuntime = runtime([], 50);
    requestRuntime.site.i18n = createLocaleSnapshot({
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      domains: { fr: 'https://fr.example.com' },
    }, requestRuntime.site.siteUrl);

    expect(runtimeArtifactOrigin(requestRuntime, 'https://example.com')).toBe('https://example.com');
    expect(runtimeArtifactOrigin(requestRuntime, 'https://fr.example.com')).toBe('https://fr.example.com');
    expect(runtimeArtifactOrigin(requestRuntime, 'https://unknown.example')).toBeNull();
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'dev' }, 'http://localhost:4321'))
      .toBe('https://example.com');
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'preview' }, 'http://127.0.0.1:4321'))
      .toBe('https://example.com');
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'dev' }, 'http://[::1]:4321'))
      .toBe('https://example.com');
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'dev' }, 'http://app.localhost:4321'))
      .toBeNull();
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'build' }, 'http://localhost:4321'))
      .toBeNull();
    expect(runtimeArtifactOrigin({ ...requestRuntime, command: 'build' }, 'http://example.com'))
      .toBe('https://example.com');
  });

  test('lets the Astro route locale outrank site.defaultLocale', async () => {
    const requestRuntime = runtime(['/fr/guide'], 50);
    requestRuntime.config = resolveConfig({
      site: { defaultLocale: 'en' },
      corpus: { manifest: { enabled: true } },
    });
    requestRuntime.site.i18n = createLocaleSnapshot({
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      routing: { prefixDefaultLocale: true },
    }, requestRuntime.site.siteUrl);

    const manifest = await serveCorpusArtifact(
      '/llms/manifest.json',
      requestRuntime,
      async () => loaded(html('French guide')),
    );

    expect(JSON.parse(manifest.body).locales).toMatchObject([
      { locale: 'fr', language: 'fr' },
    ]);
  });

  test('fails the corpus plan on invalid hreflang data as the build path does', async () => {
    const requestRuntime = runtime(['/guide'], 50);
    const catalog = {
      listPages: () => [{
        pathname: '/guide',
        title: 'Guide',
        alternates: [{ language: 'not a language', url: 'https://example.com/guide/' }],
      }],
    };
    const fetcher = async () => loaded(html('Guide'));

    await expect(serveCorpusArtifact('/llms.txt', requestRuntime, fetcher, {
      catalogLoaders: [catalogLoader(catalog)],
    })).rejects.toBeInstanceOf(RuntimeCorpusPlanError);
  });

  test('accepts a localhost hreflang only while a dev or preview server runs', async () => {
    const catalog = {
      listPages: () => [{
        pathname: '/guide',
        title: 'Guide',
        alternates: [{ language: 'fr', url: 'http://localhost:4321/fr/guide/' }],
      }],
    };
    const fetcher = async () => loaded(html('Guide'));

    for (const command of ['dev', 'preview']) {
      const artifact = await serveCorpusArtifact('/llms.txt', { ...runtime(['/guide'], 50), command }, fetcher, {
        catalogLoaders: [catalogLoader(catalog, `./catalog-${command}.js`)],
      });
      expect(artifact.body).toContain('Guide');
    }
    await expect(serveCorpusArtifact('/llms.txt', { ...runtime(['/guide'], 50), command: 'build' }, fetcher, {
      catalogLoaders: [catalogLoader(catalog, './catalog-build.js')],
    })).rejects.toBeInstanceOf(RuntimeCorpusPlanError);
  });

  test('fails closed when a page lifecycle hook throws during corpus collection', async () => {
    const requestRuntime = runtime(['/page']);
    requestRuntime.config = resolveConfig({
      corpus: { full: { enabled: true } },
    });
    const pluginLoaders = [{
      name: 'throwing-metadata',
      module: './throwing-metadata.js',
      stages: ['page:metadata'],
      claims: [],
      load: async () => ({
        name: 'throwing-metadata',
        apiVersion: 1,
        setup(api) {
          api.on('page:metadata', () => {
            throw new Error('private lifecycle details');
          });
        },
      }),
    }];

    await expect(serveCorpusArtifact(
      '/llms-full.txt',
      requestRuntime,
      async () => loaded(),
      { pluginLoaders },
    )).rejects.toBeInstanceOf(RuntimeCorpusPlanError);
  });
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

  test('fails closed when a page lifecycle hook throws during collection', async () => {
    const schemaRuntime = runtime(['/page']);
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const pluginLoaders = [{
      name: 'throwing-metadata',
      module: './throwing-metadata.js',
      stages: ['page:metadata'],
      claims: [],
      load: async () => ({
        name: 'throwing-metadata',
        apiVersion: 1,
        setup(api) {
          api.on('page:metadata', () => {
            throw new Error('private lifecycle details');
          });
        },
      }),
    }];

    await expect(serveSchemaCorpus(
      'schema-graph',
      schemaRuntime,
      async () => loaded(),
      { pluginLoaders },
    )).rejects.toBeInstanceOf(RuntimeSchemaCorpusError);
  });

  test('keeps lifecycle warnings non-fatal during collection', async () => {
    const schemaRuntime = runtime(['/page']);
    schemaRuntime.config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const pluginLoaders = [{
      name: 'warning-metadata',
      module: './warning-metadata.js',
      stages: ['page:metadata'],
      claims: [],
      load: async () => ({
        name: 'warning-metadata',
        apiVersion: 1,
        setup(api) {
          api.on('page:metadata', () => ({
            action: 'keep',
            diagnostics: [{
              code: 'metadata-warning',
              severity: 'warning',
              message: 'private warning details',
            }],
          }));
        },
      }),
    }];

    const result = await serveSchemaCorpus(
      'schema-graph',
      schemaRuntime,
      async () => loaded(),
      { pluginLoaders },
    );

    expect(result.body).toContain('https://example.com/page/#webpage');
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
    requestRuntime.command = 'preview';
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
    requestRuntime.command = 'preview';
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

  test('re-lists a catalog once its revalidate window passes', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    let revision = 0;
    const listPages = vi.fn(() => [{ pathname: `/entry-${revision}` }]);
    const staticList = vi.fn(() => [{ pathname: '/static' }]);
    const loaders = [
      { ...catalogLoader({ listPages }, './cms.js'), revalidate: 10 },
      catalogLoader({ listPages: staticList }, './static.js'),
    ];
    let clock = 1_000;
    const now = () => clock;
    const paths = async () =>
      (await runtimeCatalogPagesFor(loaders, requestRuntime, undefined, now)).map((page) => page.pathname);

    expect(await paths()).toEqual(['/entry-0', '/static']);
    revision = 1;
    clock += 9_999;
    expect(await paths()).toEqual(['/entry-0', '/static']);
    clock += 1;
    // The expired listing is refreshed on this use, which still gets the last inventory.
    expect(await paths()).toEqual(['/entry-0', '/static']);
    expect(listPages).toHaveBeenCalledTimes(2);
    await settle();
    expect(await paths()).toEqual(['/entry-1', '/static']);
    expect(listPages).toHaveBeenCalledTimes(2);
    expect(staticList).toHaveBeenCalledOnce();
  });

  test('re-lists on every use with revalidate 0 and shares a listing in flight', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    const listPages = vi.fn(async () => [{ pathname: '/live' }]);
    const loaders = [{ ...catalogLoader({ listPages }), revalidate: 0 }];

    await Promise.all([
      runtimeCatalogPagesFor(loaders, requestRuntime),
      runtimeCatalogPagesFor(loaders, requestRuntime),
    ]);
    expect(listPages).toHaveBeenCalledOnce();
    await runtimeCatalogPagesFor(loaders, requestRuntime);
    await settle();
    await runtimeCatalogPagesFor(loaders, requestRuntime);
    expect(listPages).toHaveBeenCalledTimes(3);
  });

  test('keeps revalidate false and omitted catalogs for the life of the process', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    const listPages = vi.fn(() => [{ pathname: '/once' }]);
    const loaders = [{ ...catalogLoader({ listPages }), revalidate: /** @type {false} */ (false) }];
    let clock = 0;
    await runtimeCatalogPagesFor(loaders, requestRuntime, undefined, () => clock);
    clock = Number.MAX_SAFE_INTEGER;
    await runtimeCatalogPagesFor(loaders, requestRuntime, undefined, () => clock);
    expect(listPages).toHaveBeenCalledOnce();
  });

  test('retries a failed revalidating catalog on its next use', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    let fail = true;
    const listPages = vi.fn(() => {
      if (fail) throw new Error('database not ready');
      return [{ pathname: '/recovered' }];
    });
    const loaders = [{ ...catalogLoader({ listPages }), revalidate: 60 }];
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await runtimeCatalogPagesFor(loaders, requestRuntime)).toEqual([]);
      fail = false;
      expect((await runtimeCatalogPagesFor(loaders, requestRuntime)).map((page) => page.pathname))
        .toEqual(['/recovered']);
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  test('keeps the last listing when a revalidating catalog fails to refresh', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    let result = () => [{ pathname: '/first' }];
    const listPages = vi.fn(() => result());
    const loaders = [{ ...catalogLoader({ listPages }), revalidate: 10 }];
    let clock = 0;
    const paths = async () =>
      (await runtimeCatalogPagesFor(loaders, requestRuntime, undefined, () => clock)).map((page) => page.pathname);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await paths()).toEqual(['/first']);
      result = () => { throw new Error('database unavailable'); };
      clock = 10_000;
      expect(await paths()).toEqual(['/first']);
      await settle();
      expect(warning).toHaveBeenCalledOnce();
      expect(warning.mock.calls[0][0]).toContain('its last listing is kept');
      // The failed refresh waits one more window instead of retrying on every use.
      clock = 19_999;
      expect(await paths()).toEqual(['/first']);
      expect(listPages).toHaveBeenCalledTimes(2);
      result = () => [{ pathname: '/second' }];
      clock = 20_000;
      expect(await paths()).toEqual(['/first']);
      await settle();
      expect(await paths()).toEqual(['/second']);
      expect(listPages).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
    }
  });

  test('serves the last inventory while a slow refresh runs', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'build';
    /** @type {(pages: { pathname: string }[]) => void} */
    let finish = () => {};
    let calls = 0;
    const listPages = vi.fn(() => (++calls === 1
      ? [{ pathname: '/old' }]
      : new Promise((resolve) => { finish = resolve; })));
    const loaders = [{ ...catalogLoader({ listPages }), revalidate: 10 }];
    let clock = 0;
    const paths = async () =>
      (await runtimeCatalogPagesFor(loaders, requestRuntime, undefined, () => clock)).map((page) => page.pathname);

    expect(await paths()).toEqual(['/old']);
    clock = 10_000;
    // Neither the request that starts the refresh nor one during it waits for it.
    expect(await paths()).toEqual(['/old']);
    expect(await paths()).toEqual(['/old']);
    expect(listPages).toHaveBeenCalledTimes(2);
    finish([{ pathname: '/new' }]);
    await settle();
    expect(await paths()).toEqual(['/new']);
  });

  test('caches a rejected runtime catalog loader and warns once', async () => {
    const requestRuntime = runtime();
    requestRuntime.command = 'preview';
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

  test('re-evaluates runtime catalogs during development', async () => {
    const requestRuntime = runtime();
    let revision = 0;
    const listPages = vi.fn(() => [{
      pathname: '/dynamic',
      markdown: `# Revision ${++revision}`,
    }]);
    const loaders = [catalogLoader({ listPages })];

    const first = await serveLlmsIndex('llms-full', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
    });
    const second = await serveLlmsIndex('llms-full', requestRuntime, async () => loaded(), {
      catalogLoaders: loaders,
    });

    expect(first).toContain('Revision 1');
    expect(second).toContain('Revision 2');
    expect(listPages).toHaveBeenCalledTimes(2);
  });
});

describe('runtime page inventory', () => {
  test('merges static, automatic, and catalog pages with catalog precedence', async () => {
    const requestRuntime = runtime(['/static', '/products/catalog'], 10);
    const dynamicRouteSource = {
      mode: 'startup',
      load: async () => ({
        list: () => [{
          entrypoint: 'src/pages/products/[slug].astro',
          pattern: '/products/[slug]',
          params: ['slug'],
          segments: [
            [{ content: 'products', dynamic: false, spread: false }],
            [{ content: 'slug', dynamic: true, spread: false }],
          ],
          load: async () => ({
            getStaticPaths: () => [
              { params: { slug: 'automatic' } },
              { params: { slug: 'catalog' } },
              { params: { slug: 'why?' } },
            ],
          }),
        }],
      }),
    };
    const catalogLoaders = [catalogLoader({
      listPages: () => [
        { pathname: '/products/catalog', title: 'Catalog title', markdown: '# Catalog' },
        { pathname: '/catalog-only', markdown: '# Only' },
      ],
    })];

    const inventory = await buildRuntimePageInventory(requestRuntime, {
      catalogLoaders,
      dynamicRouteSource,
    });

    expect(inventory.targets.map((target) => target.pathname)).toEqual([
      '/static',
      '/products/catalog',
      '/products/automatic',
      '/products/why%3F',
      '/catalog-only',
    ]);
    expect(inventory.targets[1].descriptor).toMatchObject({ title: 'Catalog title' });
    expect(inventory.targets[3].publicPathname).toBe('/products/why%3F');
  });

  test('enforces the page limit after cross-source deduplication', async () => {
    const requestRuntime = runtime(['/same'], 1);
    const dynamicRouteSource = {
      mode: 'startup',
      load: async () => ({
        list: () => [{
          entrypoint: 'src/pages/[slug].astro',
          pattern: '/[slug]',
          params: ['slug'],
          segments: [[{ content: 'slug', dynamic: true, spread: false }]],
          load: async () => ({
            getStaticPaths: () => [{ params: { slug: 'same' } }],
          }),
        }],
      }),
    };
    const result = await buildRuntimePageInventory(requestRuntime, { dynamicRouteSource });
    expect(result.targets).toHaveLength(1);
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

test('semantic plugin preserves encoded reserved route segments without allowing traversal', async () => {
  const rt = runtime(['/archive/why%3Fnow%23yes']);
  rt.config = resolveConfig({ schema: { corpus: { enabled: true } } });
  const body = html('Archive why?now#yes');
  const page = await pageFromHtml('/archive/why%3Fnow%23yes', body, rt);
  const result = await enrichRuntimePageGraph(body, page, rt);
  expect(result.isolated).toBe(false);
  expect(result.page.pathname).toBe('/archive/why%3Fnow%23yes');
  expect(result.page.markdownUrl).toBe('https://example.com/archive/why%3Fnow%23yes.md');
});
