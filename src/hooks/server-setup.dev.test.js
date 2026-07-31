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
    expect(body).toContain('dev preview');
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
