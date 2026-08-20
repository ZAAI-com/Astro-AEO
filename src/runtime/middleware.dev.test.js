import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = join(REPO, 'fixtures', 'demo');
const PORT = 4329;

// Resolve Astro's CLI entry from its own bin field so this works across major
// versions (Astro 5 ships astro.js, Astro 7 ships bin/astro.mjs).
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);
// 127.0.0.1, not "localhost": Node's fetch resolves localhost to ::1, but the
// Astro dev server binds IPv4, so localhost would never connect under Vitest.
const BASE = `http://127.0.0.1:${PORT}`;

/** @type {import('node:child_process').ChildProcess} */
let server;

async function waitForReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error('dev server did not become ready in time');
}

beforeAll(async () => {
  // Give the child a clean env: Vitest injects NODE_OPTIONS and VITEST* vars that
  // break the child's own Vite (it prints "ready" but never binds). ASTRO_DEV_BACKGROUND
  // keeps Astro 7's dev server in the foreground so we can tear it down in afterAll.
  const childEnv = { ...process.env, ASTRO_DEV_BACKGROUND: '1' };
  delete childEnv.NODE_OPTIONS;
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('VITEST') || key.startsWith('__VITEST') || key.startsWith('TINYPOOL')) delete childEnv[key];
  }
  server = spawn(
    'node',
    // --host 127.0.0.1 pins the dev server to IPv4 loopback so it matches BASE.
    [astroBin, 'dev', '--root', DEMO, '--host', '127.0.0.1', '--port', String(PORT)],
    { cwd: REPO, stdio: 'ignore', env: childEnv },
  );
  await waitForReady();
});

afterAll(() => {
  if (server) server.kill('SIGKILL');
});

describe('dev server AEO endpoints', () => {
  test('serves a .md companion converted on the fly', async () => {
    const r = await fetch(`${BASE}/about.md`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/markdown');
    const body = await r.text();
    expect(body).toContain('# About');
  });

  test('serves robots.txt and domain-profile.json', async () => {
    const robots = await fetch(`${BASE}/robots.txt`);
    expect(robots.status).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain('User-agent: Googlebot');
    // @astrojs/sitemap only writes during builds, so automatic mode must not
    // advertise its build-only output from the live dev server.
    expect(robotsBody).not.toContain('Sitemap:');

    const dp = await fetch(`${BASE}/.well-known/domain-profile.json`);
    expect(dp.status).toBe(200);
    expect((await dp.json()).name).toBe('Astro-AEO Demo');
  });

  test('serves llms.txt for static routes with a dev-preview note', async () => {
    const r = await fetch(`${BASE}/llms.txt`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('## Home');
    expect(body).toContain('development preview');
  });

  test('automatically enumerates prerendered dynamic routes in aggregate corpora', async () => {
    const llms = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(llms).toContain('/dynamic/alpha.md');
    expect(llms).toContain('/archive/2026/launch.md');
    expect(llms).toContain('/paged/2.md');
    const full = await (await fetch(`${BASE}/llms-full.txt`)).text();
    expect(full).toContain('Body for the alpha dynamic route.');
    expect(full).toContain('Nested archive route body.');
    expect(full).toContain('Items: three.');
  });

  test('serves a direct dynamic Markdown companion without building the inventory', async () => {
    const response = await fetch(`${BASE}/dynamic/alpha.md`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Alpha Dynamic');
  });

  test('excluded pages are not served as .md nor listed in llms.txt', async () => {
    // The demo config excludes /private/** from AEO output.
    const md = await fetch(`${BASE}/private/secret.md`);
    expect(md.status).toBe(404);
    const llms = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(llms).not.toContain('/private/secret');
  });

  // The dev server and the build used to build these strings separately and had
  // drifted apart on three settings. They now share one renderer; these assert it.
  describe('parity with the build', () => {
    test('.md frontmatter carries lastModified, which dev used to drop', async () => {
      // The demo enables markdown.frontmatter, and this post declares
      // article:modified_time. Dev previously emitted no lastModified at all.
      const body = await (await fetch(`${BASE}/blog/first-post.md`)).text();
      expect(body).toMatch(/^---\n/);
      expect(body).toContain('title: "First Post"');
      expect(body).toContain('lastModified: 2026-02-15');
    });

    test('llms.txt honours showLastModified, which dev used to ignore', async () => {
      const body = await (await fetch(`${BASE}/llms.txt`)).text();
      expect(body).toContain('_(updated 2026-02-15)_');
    });

    test('llms-full.txt honours the mode, which dev used to ignore', async () => {
      const body = await (await fetch(`${BASE}/llms-full.txt`)).text();
      // The demo leaves mode at 'all', so every eligible page is inlined.
      expect(body).toContain('# First Post');
      expect(body).toContain('# About');
      expect(body).toContain('URL: https://demo.example.com/about/');
      // no-llms-full and excluded pages stay out regardless of mode.
      expect(body).not.toContain('/private/secret');
    });

    test('a no-dotmd page is refused as .md in dev, exactly as the build omits it', async () => {
      expect((await fetch(`${BASE}/no-md.md`)).status).toBe(404);
    });
  });
});

describe('request-time contract', () => {
  test('a prerendered route always serves HTML, whatever the client asks for', async () => {
    // Astro blanks request headers for prerendered routes (core/request.js), on
    // purpose: those pages are static files in production, so honouring an Accept
    // header would work in dev and silently stop working once deployed. Content
    // negotiation is therefore an on-demand-route feature, and the demo is static.
    // The negotiation predicate itself is unit-tested in runtime/negotiate.test.js.
    const r = await fetch(`${BASE}/about/`, { headers: { accept: 'text/markdown' } });
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  test('a .md response carries an ETag that satisfies a conditional request', async () => {
    const first = await fetch(`${BASE}/about.md`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${BASE}/about.md`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  test('HEAD returns the same headers with no body', async () => {
    const head = await fetch(`${BASE}/about.md`, { method: 'HEAD' });
    const get = await fetch(`${BASE}/about.md`);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(await head.text()).toBe('');
  });

  test('Range and compression preferences cannot turn generated Markdown into a partial response', async () => {
    const response = await fetch(`${BASE}/about.md`, {
      headers: { 'accept-encoding': 'gzip', range: 'bytes=0-9' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('accept-ranges')).toBeNull();
    expect(await response.text()).toContain('# About');
  });

  test('a POST is never intercepted', async () => {
    const r = await fetch(`${BASE}/about.md`, { method: 'POST' });
    expect(r.status).not.toBe(200);
  });

  test('a .md path for a page that does not exist is a 404, not someone else HTML', async () => {
    const r = await fetch(`${BASE}/does-not-exist.md`);
    expect(r.status).toBe(404);
  });
});
