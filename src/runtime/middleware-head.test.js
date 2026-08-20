import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
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
const { etagFor } = await import('./respond.js');

const html = (head = '', body = '<main><h1>Page</h1></main>') =>
  `<!doctype html><html><head><title>Page</title>${head}</head><body>${body}</body></html>`;

const headMarker = (value) =>
  `<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>${JSON.stringify(value)}</script>`;

const contextFor = (pathname = '/page', init = {}) => {
  const url = new URL(pathname, 'https://request-host.invalid');
  const request = new Request(url, init);
  return {
    request,
    url,
    locals: {},
    isPrerendered: false,
    rewrite: vi.fn(),
  };
};

beforeEach(() => {
  RUNTIME.config = resolveConfig({ markdown: { alternateLink: 'never' } });
});

describe('runtime semantic head enrichment', () => {
  test('injects the default managed graph while preserving status and non-byte headers', async () => {
    const source = html();
    const context = contextFor();
    const response = await onRequest(context, async () => new Response(source, {
      status: 201,
      headers: {
        'content-type': 'text/html',
        'content-length': '1',
        'content-digest': 'sha-256=:stale:',
        etag: '"stale"',
        'x-application': 'preserved',
      },
    }));
    const body = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get('x-application')).toBe('preserved');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-digest')).toBe(false);
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get('etag')).not.toBe('"stale"');
    expect(body.match(/data-astro-aeo-graph/g)).toHaveLength(1);
    expect(body).toContain('https://example.test/page/#webpage');
    expect(body).not.toContain('request-host.invalid');
  });

  test('honors an explicit AeoHead when global injection and Markdown are disabled', async () => {
    RUNTIME.config = resolveConfig({
      markdown: { enabled: false, alternateLink: 'never' },
      schema: { autoInject: false },
    });
    const marker = headMarker({
      title: 'Explicit title',
      canonical: 'https://example.test/explicit',
      infer: false,
      graph: { '@id': 'https://example.test/explicit#thing', '@type': 'Thing', name: 'Explicit entity' },
    });
    const context = contextFor();
    const response = await onRequest(context, async () => new Response(html(marker), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    const body = await response.text();

    expect(body).not.toContain('data-astro-aeo-head');
    expect(body).toContain('<title>Explicit title</title>');
    expect(body).toContain('data-astro-aeo-graph');
    expect(body).toContain('Explicit entity');
    expect(body).not.toContain('WebSite');
  });

  test('no-dotmd disables the companion but not graph injection', async () => {
    const context = contextFor();
    const response = await onRequest(context, async () => new Response(
      html('<meta name="aeo" content="no-dotmd">'),
      { headers: { 'content-type': 'text/html' } },
    ));
    const body = await response.text();
    expect(body).toContain('data-astro-aeo-graph');
    expect(body).not.toContain('type="text/markdown"');
  });

  test('redacts head markers from ineligible and error HTML without injecting a graph', async () => {
    const marker = headMarker({ canonical: 'https://example.test/error', graph: { '@type': 'Thing' } });
    const context = contextFor();
    const response = await onRequest(context, async () => new Response(
      html(`<meta name="robots" content="noindex">${marker}`),
      {
        status: 404,
        headers: { 'content-type': 'text/html', 'x-application': 'preserved' },
      },
    ));
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get('x-application')).toBe('preserved');
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(body).not.toContain('data-astro-aeo-head');
    expect(body).not.toContain('data-astro-aeo-graph');
  });

  test('rehashes transformed bodies for conditional GET and bodyless HEAD', async () => {
    const render = () => new Response(html(), {
      headers: { 'content-type': 'text/html', 'x-application': 'preserved' },
    });
    const firstContext = contextFor();
    const first = await onRequest(firstContext, async () => render());
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const conditionalContext = contextFor('/page', { headers: { 'if-none-match': etag } });
    const conditional = await onRequest(conditionalContext, async () => render());
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('etag')).toBe(etag);
    expect(await conditional.text()).toBe('');

    const headContext = contextFor('/page', { method: 'HEAD' });
    headContext.rewrite.mockResolvedValue(render());
    const head = await onRequest(headContext, async () => new Response(null, {
      headers: { 'content-type': 'text/html', 'x-application': 'preserved' },
    }));
    expect(head.status).toBe(200);
    expect(head.headers.get('x-application')).toBe('preserved');
    expect(head.headers.get('etag')).toBe(etag);
    expect(await head.text()).toBe('');
  });

  test('redacts transport markers from non-GET HTML without changing application status', async () => {
    const marker = headMarker({ title: 'Must not leak' });
    const source = html(marker);
    const redacted = html();
    const context = contextFor('/page', {
      method: 'POST',
      headers: { 'if-none-match': await etagFor(redacted) },
    });
    const response = await onRequest(context, async () => new Response(source, {
      status: 201,
      headers: { 'content-type': 'text/html', 'x-application': 'preserved' },
    }));
    expect(response.status).toBe(201);
    expect(response.headers.get('x-application')).toBe('preserved');
    expect(await response.text()).toBe(redacted);
  });
});
