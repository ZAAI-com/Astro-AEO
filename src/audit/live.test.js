// @ts-check
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditTargetError, MAX_BODY_BYTES, auditLive } from './live.js';

const WORDS = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');

/** @param {string} title @param {string} body */
const page = (title, body = '') =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title} page"></head><body><h1 id="top">${title}</h1>${body}</body></html>`;

/** @type {import('node:http').Server[]} */
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => {
    server.closeAllConnections();
    server.close(done);
  })));
});

/**
 * @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void} handler
 * @returns {Promise<string>}
 */
function serve(handler) {
  return new Promise((done) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      done(`http://127.0.0.1:${address.port}`);
    });
  });
}

/** @param {Record<string, string | { status?: number; headers?: Record<string, string>; body?: string }>} routes */
function site(routes) {
  /** @type {import('node:http').IncomingHttpHeaders[]} */
  const seen = [];
  const origin = serve((request, response) => {
    seen.push(request.headers);
    const route = routes[new URL(request.url ?? '/', 'http://x').pathname];
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/html' }).end('missing');
      return;
    }
    const entry = typeof route === 'string' ? { body: route } : route;
    response.writeHead(entry.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...entry.headers }).end(entry.body ?? '');
  });
  return { origin, seen };
}

/** @param {import('../index.js').Finding[]} findings */
const ids = (findings) => findings.map((finding) => finding.ruleId).sort();

describe('live audit', () => {
  it('crawls same-origin pages, reports a broken link, and strips queries and fragments from identities', async () => {
    const { origin, seen } = site({
      '/': page('Home', '<a href="/about/?utm=1#top">a</a><a href="/about/#top">b</a><a href="/gone/">c</a><a href="/about/#nope">d</a>'),
      '/about/': page('About'),
    });
    const base = await origin;
    const result = await auditLive(`${base}/`, { timeout: 2000 });
    expect(result.pagesChecked).toBe(2);
    expect(ids(result.findings)).toEqual(['link-anchor-missing', 'link-internal-broken', 'live-fetch-failed']);
    // `/`, `/about/` once despite two spellings, and `/gone/`.
    expect(seen).toHaveLength(3);
    expect(result.scope).toMatchObject({ origins: [base], maxPages: 500, pagesFetched: 2, truncated: false });
  });

  it('sends no credentials and no caller headers', async () => {
    const { origin, seen } = site({ '/': { headers: { 'set-cookie': 'session=1' }, body: page('Home', '<a href="/next/">n</a>') }, '/next/': page('Next') });
    await auditLive(`${await origin}/`, { timeout: 2000, toolVersion: '9.9.9' });
    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers['user-agent']).toBe('astro-aeo-audit/9.9.9');
    }
  });

  it('refuses a URL that carries credentials', async () => {
    await expect(auditLive('https://user:pass@example.com/')).rejects.toBeInstanceOf(AuditTargetError);
    await expect(auditLive('ftp://example.com/')).rejects.toBeInstanceOf(AuditTargetError);
  });

  it('never contacts an origin outside the allowlist, by link or by redirect', async () => {
    const other = site({ '/': page('Other') });
    const otherOrigin = await other.origin;
    const { origin } = site({
      '/': page('Home', `<a href="${otherOrigin}/">x</a><a href="/hop/">y</a>`),
      '/hop/': { status: 302, headers: { location: `${otherOrigin}/` } },
    });
    const result = await auditLive(`${await origin}/`, { timeout: 2000 });
    expect(other.seen).toHaveLength(0);
    expect(result.scope.skippedExternal).toBe(1);
    expect(ids(result.findings)).toEqual(['live-external-skipped', 'live-external-skipped']);
    // A skipped redirect is unknown, not a broken link.
    expect(result.findings.some((finding) => finding.ruleId === 'link-internal-broken')).toBe(false);

    const allowed = await auditLive(`${await origin}/`, { timeout: 2000, allowOrigins: [otherOrigin] });
    expect(other.seen.length).toBeGreaterThan(0);
    expect(allowed.pagesChecked).toBe(2);
  });

  it('counts a page once when a redirect to it and the page itself share a batch', async () => {
    // With hostnames the batch order is fixed: a.test/hop/ sorts before b.test/, so the
    // redirect is processed first and must claim the page for the direct fetch too.
    const html = (/** @type {string} */ title, /** @type {string} */ body = '') =>
      new Response(page(title, body), { headers: { 'content-type': 'text/html' } });
    const fetch = /** @type {typeof globalThis.fetch} */ (async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.href === 'http://a.test/') return html('Home', '<a href="http://b.test/">b</a><a href="/hop/">hop</a>');
      if (url.href === 'http://a.test/hop/') return new Response(null, { status: 302, headers: { location: 'http://b.test/' } });
      if (url.href === 'http://b.test/') return html('B');
      return new Response('missing', { status: 404 });
    });
    const result = await auditLive('http://a.test/', { fetch, allowOrigins: ['http://b.test'], concurrency: 4 });
    expect(result.pagesChecked).toBe(2);
    expect(result.findings.filter((finding) => finding.ruleId.endsWith('-duplicate'))).toEqual([]);
  });

  it('stops at the page cap deterministically and says so', async () => {
    const links = ['/c/', '/a/', '/b/'].map((href) => `<a href="${href}">x</a>`).join('');
    const { origin, seen } = site({ '/': page('Home', links), '/a/': page('A'), '/b/': page('B'), '/c/': page('C') });
    const result = await auditLive(`${await origin}/`, { timeout: 2000, maxPages: 2, concurrency: 4 });
    expect(seen.map((headers) => headers.host)).toHaveLength(2);
    expect(result.scope).toMatchObject({ maxPages: 2, pagesFetched: 2, truncated: true });
    expect(ids(result.findings)).toContain('live-page-cap-reached');
    // The unreached pages are unknown, so their links are not reported as broken.
    expect(ids(result.findings)).not.toContain('link-internal-broken');
    const unlimited = await auditLive(`${await origin}/`, { timeout: 2000, maxPages: 'unlimited' });
    expect(unlimited.scope).toMatchObject({ maxPages: 'unlimited', pagesFetched: 4, truncated: false });
  });

  it('gives up on a redirect loop after five hops', async () => {
    const { origin, seen } = site({
      '/': page('Home', '<a href="/loop/">x</a>'),
      '/loop/': { status: 301, headers: { location: '/loop/' } },
    });
    const result = await auditLive(`${await origin}/`, { timeout: 2000 });
    expect(ids(result.findings)).toEqual(['live-redirect-limit']);
    expect(seen).toHaveLength(1 + 6);
  });

  it('abandons an oversized body', async () => {
    const { origin } = site({ '/': page('Home', '<a href="/big/">x</a>'), '/big/': page('Big', 'x'.repeat(MAX_BODY_BYTES + 1)) });
    const result = await auditLive(`${await origin}/`, { timeout: 5000 });
    expect(ids(result.findings)).toEqual(['live-body-too-large']);
    expect(result.pagesChecked).toBe(1);
  });

  it('reports a timeout on a linked page and fails the run when the start page times out', async () => {
    const origin = await serve((request, response) => {
      if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html' }).end(page('Home', '<a href="/slow/">x</a>'));
      // `/slow/` never answers.
    });
    const result = await auditLive(`${origin}/`, { timeout: 150 });
    expect(result.findings.find((finding) => finding.ruleId === 'live-target-unreachable')?.message).toContain('timed out');
    await expect(auditLive(`${origin}/slow/`, { timeout: 150 })).rejects.toBeInstanceOf(AuditTargetError);
  });

  it('fetches the Markdown companion and checks how it is served', async () => {
    const head = '<link rel="alternate" type="text/markdown" href="/index.md">';
    const { origin } = site({
      '/': page('Home').replace('</head>', `${head}</head>`),
      '/index.md': { headers: { 'content-type': 'text/plain' }, body: `# Home\n\n${WORDS}\n` },
    });
    const result = await auditLive(`${await origin}/`, { timeout: 2000 });
    expect(ids(result.findings)).toEqual(['live-markdown-mime']);
  });
});
