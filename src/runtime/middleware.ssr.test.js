import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The on-demand half of the contract. Everything here is untestable against a
// static build or `astro dev`, because Astro does not expose request headers to a
// prerendered route: content negotiation only exists on an adapter.
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/ssr-node');
const PORT = 4462;
// The adapter binds `localhost`, which can resolve to ::1 while the server listens
// on IPv4. HOST pins it, and the tests use the same literal.
const BASE = `http://127.0.0.1:${PORT}`;

const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(REPO, 'node_modules/astro', typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro);

let server;

async function waitForReady() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('SSR server did not become ready');
}

beforeAll(async () => {
  execFileSync('node', [astroBin, 'build', '--root', FIXTURE], { cwd: REPO, stdio: 'ignore' });
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) };
  for (const key of Object.keys(env)) {
    if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  server = spawn('node', [join(FIXTURE, 'dist/server/entry.mjs')], { cwd: REPO, env, stdio: 'ignore' });
  await waitForReady();
});

afterAll(() => {
  if (server) server.kill('SIGKILL');
});

describe('on-demand .md companions', () => {
  test('a page rendered per request has a .md companion', async () => {
    const r = await fetch(`${BASE}/about.md`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/markdown');
    const body = await r.text();
    expect(body).toMatch(/^---\n/);
    // The configured suffix is stripped at request time, not just at build time.
    expect(body).toContain('title: "About"');
    expect(body).not.toContain('SSR Site');
    expect(body).toContain('# About');
  });

  test('relative links are absolute, and chrome is gone', async () => {
    const body = await (await fetch(`${BASE}/about.md`)).text();
    expect(body).toContain('(https://ssr.example.com/contact/)');
    expect(body).not.toContain('Chrome.');
  });

  test('a prerendered page in a server build still has its build-time .md', async () => {
    // It cannot come from a rewrite: an on-demand route may not rewrite into a
    // prerendered one. It is a build artifact served as a static asset.
    const r = await fetch(`${BASE}/static-page.md`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('# Static Page');
  });

  test('an excluded page is a 404 and its content does not appear', async () => {
    const r = await fetch(`${BASE}/private/secret.md`);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('SENSITIVE-MARKER');
  });

  test('a no-dotmd page is refused', async () => {
    expect((await fetch(`${BASE}/no-md.md`)).status).toBe(404);
  });
});

describe("the project's own middleware still guards a .md request", () => {
  test('an unauthorized .md gets the status the project chose, not a generic 404', async () => {
    // The .md rewrites into /gated, so the project's auth runs. Flattening its 403
    // to 404 would contradict the decision it just made.
    const r = await fetch(`${BASE}/gated.md`);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain('GATED-CONTENT');
  });

  test('an authorized .md is served', async () => {
    const r = await fetch(`${BASE}/gated.md`, { headers: { 'x-token': 'letmein' } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('GATED-CONTENT');
  });
});

describe('content negotiation', () => {
  test('an explicit Accept for markdown is honoured at the page URL', async () => {
    const r = await fetch(`${BASE}/about/`, { headers: { accept: 'text/markdown' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/markdown');
    expect(r.headers.get('vary')).toBe('Accept');
    expect(r.headers.get('link')).toBe('<https://ssr.example.com/about/>; rel="canonical"');
    expect(await r.text()).toContain('# About');
  });

  test('a browser Accept header gets HTML', async () => {
    const r = await fetch(`${BASE}/about/`, {
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  test('a wildcard is not consent, so curl and crawlers get HTML', async () => {
    const r = await fetch(`${BASE}/about/`, { headers: { accept: '*/*' } });
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  test('a tie resolves to HTML', async () => {
    const r = await fetch(`${BASE}/about/`, { headers: { accept: 'text/markdown, text/html' } });
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  test('no Accept header at all gets HTML', async () => {
    const r = await fetch(`${BASE}/about/`);
    expect(r.headers.get('content-type')).toContain('text/html');
  });
});

describe('response contract', () => {
  test('ETag satisfies a conditional request', async () => {
    const first = await fetch(`${BASE}/about.md`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${BASE}/about.md`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  test('HEAD matches GET headers with no body', async () => {
    const head = await fetch(`${BASE}/about.md`, { method: 'HEAD' });
    const get = await fetch(`${BASE}/about.md`);
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(await head.text()).toBe('');
  });

  test('robots.txt is served with the configured policy', async () => {
    const body = await (await fetch(`${BASE}/robots.txt`)).text();
    expect(body).toContain('User-agent: Googlebot');
  });

  test('a POST is never intercepted', async () => {
    expect((await fetch(`${BASE}/about.md`, { method: 'POST' })).status).not.toBe(200);
  });
});
