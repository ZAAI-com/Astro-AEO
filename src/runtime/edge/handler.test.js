// @ts-check
import { describe, expect, test } from 'vitest';
import { ACCEPT_CONTRACT } from '../../../test/contracts/accept.js';
import { createCloudflareHandler } from './cloudflare.js';
import { EDGE_MANIFEST_PATHNAME, createEdgeNegotiator, readEdgeManifest, withVaryAccept } from './handler.js';
import { createNetlifyHandler } from './netlify.js';
import { createVercelHandler } from './vercel.js';

const ORIGIN = 'https://static.example.com';
const MARKDOWN = '# Guide\n\nBody.\n';
const ETAG = '"abc123"';

/** @param {'response' | 'redirect'} mode @param {string} [base] */
const manifest = (mode, base = '') => ({
  version: 1,
  provider: 'cloudflare',
  mode,
  base: base || '/',
  routes: [
    { html: `${base}/`, markdown: `${base}/index.md` },
    { html: `${base}/guide/`, markdown: `${base}/guide.md` },
    { html: `${base}/caf%C3%A9/`, markdown: `${base}/caf%C3%A9.md` },
    { html: `${base}/stale/`, markdown: `${base}/stale.md` },
  ],
});

/**
 * A static host: serves the manifest and companions as assets, HTML as the origin.
 * @param {unknown} manifestBody @param {string} [base]
 */
function host(manifestBody, base = '') {
  /** @type {string[]} */
  const assetRequests = [];
  /** @param {string} pathname */
  const asset = async (pathname) => {
    assetRequests.push(pathname);
    if (pathname === `${base}${EDGE_MANIFEST_PATHNAME}`) {
      return manifestBody === undefined
        ? new Response('missing', { status: 404 })
        : new Response(typeof manifestBody === 'string' ? manifestBody : JSON.stringify(manifestBody));
    }
    if (pathname.endsWith('.md') && !pathname.endsWith('/stale.md')) {
      return new Response(MARKDOWN, { headers: { etag: ETAG, 'cache-control': 'public, max-age=60', 'content-type': 'application/octet-stream' } });
    }
    return new Response('not found', { status: 404 });
  };
  const origin = async () => new Response('<html>page</html>', { headers: { 'content-type': 'text/html', vary: 'Accept-Encoding' } });
  return { asset, origin, assetRequests };
}

/** @typedef {(request: Request) => Promise<{ kind: 'markdown' | 'html' | 'redirect' | 'pass'; response: Response }>} Run */

/**
 * Each factory is reduced to the same observable result, so one suite holds all
 * three hosts (and the shared negotiator) to one contract.
 * @type {Record<string, (manifestBody: unknown, base?: string) => { run: Run; assetRequests: string[] }>}
 */
const FACTORIES = {
  negotiator(manifestBody, base) {
    const site = host(manifestBody, base);
    const negotiate = createEdgeNegotiator({ base, fetchAsset: (pathname) => site.asset(pathname) });
    return { assetRequests: site.assetRequests, run: async (request) => classify(await negotiate(request, site.origin)) };
  },
  cloudflare(manifestBody, base) {
    const site = host(manifestBody, base);
    const env = { ASSETS: { fetch: (/** @type {Request} */ request) => site.asset(new URL(request.url).pathname) } };
    const handler = createCloudflareHandler({ base });
    return { assetRequests: site.assetRequests, run: async (request) => classify(await handler.onRequest({ request, env, next: site.origin })) };
  },
  netlify(manifestBody, base) {
    const site = host(manifestBody, base);
    const handler = createNetlifyHandler({ base });
    const context = { next: (/** @type {Request} */ request) => (request ? site.asset(new URL(request.url).pathname) : site.origin()) };
    return { assetRequests: site.assetRequests, run: async (request) => classify(await handler(request, context)) };
  },
  vercel(manifestBody, base) {
    const site = host(manifestBody, base);
    const handler = createVercelHandler({
      base,
      fetch: /** @type {any} */ ((/** @type {URL} */ url) => site.asset(new URL(url).pathname)),
      next: (init) => new Response(null, { headers: { 'x-middleware-next': '1', ...init?.headers } }),
      rewrite: (destination, init) => new Response(null, { headers: { 'x-middleware-rewrite': String(destination), ...init?.headers } }),
    });
    return {
      assetRequests: site.assetRequests,
      run: async (request) => {
        const response = await handler(request);
        if (response.status === 303) return { kind: 'redirect', response };
        const rewritten = response.headers.get('x-middleware-rewrite');
        if (rewritten) {
          // The platform serves the rewritten asset. A stale manifest shows up there as a 404.
          const served = await site.asset(new URL(rewritten).pathname);
          return { kind: served.ok ? 'markdown' : 'pass', response };
        }
        return { kind: response.headers.get('vary') ? 'html' : 'pass', response };
      },
    };
  },
};

/** @param {Response} response */
function classify(response) {
  if (response.status === 303) return { kind: /** @type {const} */ ('redirect'), response };
  if ((response.headers.get('content-type') ?? '').startsWith('text/markdown')) return { kind: /** @type {const} */ ('markdown'), response };
  const vary = (response.headers.get('vary') ?? '').toLowerCase();
  return { kind: vary.includes('accept,') || vary.endsWith('accept') ? /** @type {const} */ ('html') : /** @type {const} */ ('pass'), response };
}

/** @param {string} path @param {Record<string, string>} [headers] @param {string} [method] */
const request = (path, headers = {}, method = 'GET') => new Request(`${ORIGIN}${path}`, { method, headers });

describe.each(Object.keys(FACTORIES))('%s edge handler', (name) => {
  const create = FACTORIES[name];

  test.each(ACCEPT_CONTRACT)('Accept contract: $name', async ({ accept, markdown }) => {
    const { run } = create(manifest('response'));
    const result = await run(request('/guide/', accept === null ? {} : { accept }));
    expect(result.kind).toBe(markdown ? 'markdown' : 'html');
  });

  test('varies on Accept for an eligible route whichever representation is chosen', async () => {
    const { run } = create(manifest('response'));
    for (const accept of ['text/html', 'text/markdown']) {
      const { response } = await run(request('/guide/', { accept }));
      expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('accept');
    }
  });

  test('passes through a route the manifest does not list, untouched', async () => {
    const { run } = create(manifest('response'));
    expect((await run(request('/unlisted/', { accept: 'text/markdown' }))).kind).toBe('pass');
    expect((await run(request('/guide/extra', { accept: 'text/markdown' }))).kind).toBe('pass');
  });

  test('matches a route with or without its trailing slash, and in its encoded spelling', async () => {
    const { run } = create(manifest('response'));
    for (const path of ['/guide', '/guide/', '/', '/caf%C3%A9/']) {
      expect((await run(request(path, { accept: 'text/markdown' }))).kind, path).toBe('markdown');
    }
  });

  test('only negotiates GET and HEAD', async () => {
    const { run, assetRequests } = create(manifest('response'));
    expect((await run(request('/guide/', { accept: 'text/markdown' }, 'POST'))).kind).toBe('pass');
    expect(assetRequests).toEqual([]);
    expect((await run(request('/guide/', { accept: 'text/markdown' }, 'HEAD'))).kind).toBe('markdown');
  });

  test('redirect mode answers 303 to the companion and preserves the query', async () => {
    const { run } = create(manifest('redirect'));
    const { kind, response } = await run(request('/guide/?ref=a%20b', { accept: 'text/markdown' }));
    expect(kind).toBe('redirect');
    expect(response.headers.get('location')).toBe('/guide.md?ref=a%20b');
    expect(response.headers.get('vary')).toBe('Accept');
    expect((await run(request('/guide/', { accept: 'text/html' }))).kind).toBe('html');
  });

  test('honors the site base for the manifest and its routes', async () => {
    const { run, assetRequests } = create(manifest('response', '/docs'), '/docs');
    expect((await run(request('/docs/guide/', { accept: 'text/markdown' }))).kind).toBe('markdown');
    expect(assetRequests[0]).toBe(`/docs${EDGE_MANIFEST_PATHNAME}`);
    expect((await run(request('/guide/', { accept: 'text/markdown' }))).kind).toBe('pass');
  });

  test.each([
    ['missing', undefined],
    ['not JSON', '{nope'],
    ['a future version', { ...manifest('response'), version: 2 }],
    ['an unknown mode', { ...manifest('response'), mode: 'proxy' }],
    ['an unsafe companion path', { ...manifest('response'), routes: [{ html: '/guide/', markdown: '/../secret.md' }] }],
    ['a companion that is not Markdown', { ...manifest('response'), routes: [{ html: '/guide/', markdown: '/guide.html' }] }],
    ['a malformed route', { ...manifest('response'), routes: [{ html: '/guide/' }] }],
  ])('fails closed to HTML when the manifest is %s', async (_label, body) => {
    const { run } = create(body);
    expect((await run(request('/guide/', { accept: 'text/markdown' }))).kind).toBe('pass');
  });

  test('fails closed to HTML when the manifest is stale and the companion is gone', async () => {
    const { run } = create(manifest('response'));
    expect(['html', 'pass']).toContain((await run(request('/stale/', { accept: 'text/markdown' }))).kind);
  });

  test('never inspects a manifest for its own subrequests', async () => {
    const { run, assetRequests } = create(manifest('response'));
    await run(request(EDGE_MANIFEST_PATHNAME, { accept: 'text/markdown' }));
    await run(request('/guide.md', { accept: 'text/markdown' }));
    expect(assetRequests).toEqual([]);
  });
});

describe('shared negotiator responses', () => {
  const create = () => {
    const site = host(manifest('response'));
    const negotiate = createEdgeNegotiator({ fetchAsset: (pathname) => site.asset(pathname) });
    return { site, run: (/** @type {Request} */ req) => negotiate(req, site.origin) };
  };

  test('serves the companion as text/markdown with the asset validators and cache policy', async () => {
    const response = await create().run(request('/guide/', { accept: 'text/markdown' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('etag')).toBe(ETAG);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await response.text()).toBe(MARKDOWN);
  });

  test('answers a conditional request with 304 and HEAD without a body', async () => {
    const { run } = create();
    const conditional = await run(request('/guide/', { accept: 'text/markdown', 'if-none-match': `W/${ETAG}` }));
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe('');
    const head = await run(request('/guide/', { accept: 'text/markdown' }, 'HEAD'));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('etag')).toBe(ETAG);
  });

  test('keeps the HTML body and merges Vary without duplicating it', async () => {
    const response = await create().run(request('/guide/', { accept: 'text/html' }));
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Accept');
    expect(await response.text()).toBe('<html>page</html>');
    expect(withVaryAccept(new Response('', { headers: { vary: 'accept' } })).headers.get('vary')).toBe('accept');
    expect(withVaryAccept(new Response('', { headers: { vary: '*' } })).headers.get('vary')).toBe('*');
  });

  test('retries a bad manifest on the next request and keeps a good one', async () => {
    let body = /** @type {unknown} */ ('{nope');
    /** @type {string[]} */
    const seen = [];
    const negotiate = createEdgeNegotiator({
      fetchAsset: async (pathname) => {
        seen.push(pathname);
        if (pathname === EDGE_MANIFEST_PATHNAME) return new Response(typeof body === 'string' ? body : JSON.stringify(body));
        return new Response(MARKDOWN, { headers: { etag: ETAG } });
      },
    });
    const origin = async () => new Response('html', { headers: { 'content-type': 'text/html' } });
    const markdown = () => negotiate(request('/guide/', { accept: 'text/markdown' }), origin);
    expect((await markdown()).headers.get('content-type')).toBe('text/html');
    body = manifest('response');
    expect((await markdown()).headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    await markdown();
    expect(seen.filter((pathname) => pathname === EDGE_MANIFEST_PATHNAME)).toHaveLength(2);
  });

  test('rejects an oversized or non-array route list', () => {
    expect(readEdgeManifest({ ...manifest('response'), routes: 'x' })).toBeNull();
    expect(readEdgeManifest({ ...manifest('response'), routes: new Array(200_001).fill({ html: '/', markdown: '/index.md' }) })).toBeNull();
    expect(readEdgeManifest(manifest('response'))?.routes.get('/guide')).toBe('/guide.md');
  });

  test('the Vercel factory refuses to start without its platform helpers', () => {
    expect(() => createVercelHandler(/** @type {any} */ ({}))).toThrow(/@vercel\/functions/);
  });

  test('a Cloudflare Worker without an assets binding says so instead of looping', async () => {
    const response = await createCloudflareHandler().fetch(request('/guide/'), {});
    expect(response.status).toBe(500);
  });
});
