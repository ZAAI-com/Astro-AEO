import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcessTree } from '../../scripts/process-tree.mjs';
import { ASTRO_BIN, REPO, fetchWithHost, stopProcess, waitForReady } from '../adapters/helpers.js';

// The EmDash recipe is an on-demand CMS site: the build emits no page HTML, so
// this suite proves the integration by booting the built server and asserting
// the request-time contract against seeded content.

const RECIPE = join(REPO, 'recipes/emdash');
const EMDASH_BIN = join(REPO, 'node_modules/emdash/dist/cli/index.mjs');
const HOST = 'recipe.example.com';
const BASE = 'http://127.0.0.1:4399';

/** @type {import('node:child_process').ChildProcess | undefined} */
let server;

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: RECIPE,
    encoding: 'utf8',
    env: cleanEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return result;
}

beforeAll(async () => {
  // Hermetic database: rebuild data.db from the committed seed, then build.
  // Stale WAL sidecar files from an earlier server corrupt a fresh database,
  // so every SQLite sidecar goes with it.
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(join(RECIPE, `data.db${suffix}`), { force: true });
  }
  run(process.execPath, [EMDASH_BIN, 'seed', 'seed/seed.json']);
  run(process.execPath, [ASTRO_BIN, 'build', '--root', RECIPE]);

  // EmDash resolves its SQLite URL against the process cwd, so the standalone
  // server must run from the recipe root.
  server = spawnProcessTree(process.execPath, ['dist/server/entry.mjs'], {
    cwd: RECIPE,
    env: { ...cleanEnvironment(), HOST: '127.0.0.1', PORT: '4399' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady(BASE, { child: server, output: () => '' });
}, 240_000);

afterAll(async () => {
  await stopProcess(server);
});

describe('emdash recipe', () => {
  test('llms.txt lists published CMS pages and excludes the admin and drafts', async () => {
    const response = await fetchWithHost(`${BASE}/llms.txt`, HOST);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('/posts/signals-in-static-sites.md');
    expect(body).toContain('/posts/crawling-without-credentials.md');
    expect(body).toContain('/work/aeo-field-guide.md');
    expect(body).toContain('(/index.md)');
    expect(body).not.toContain('_emdash');
    expect(body).not.toContain('unpublished-sketch');
  });

  test('llms-full.txt carries the rendered corpus', async () => {
    const response = await fetchWithHost(`${BASE}/llms-full.txt`, HOST);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('# Signals a static site sends to answer engines');
    expect(body).toContain('# AEO Field Guide');
  });

  test('a CMS page serves a markdown companion through its own route', async () => {
    const response = await fetch(`${BASE}/posts/signals-in-static-sites.md`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    const body = await response.text();
    expect(body).toContain('# Signals a static site sends to answer engines');
    expect(body).toContain('Three signals that matter');
  });

  test('a CMS page negotiates markdown by Accept header', async () => {
    const response = await fetch(`${BASE}/posts/portable-text-in-practice`, {
      headers: { accept: 'text/markdown;q=0.9,text/html;q=0.8' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    const body = await response.text();
    expect(body).toContain('# Portable Text in practice');
  });

  test('the EmDash admin is reachable but never negotiated as markdown', async () => {
    const html = await fetch(`${BASE}/_emdash/admin/`);
    expect([200, 301, 302, 307, 308]).toContain(html.status);
    const negotiated = await fetch(`${BASE}/_emdash/admin/`, {
      headers: { accept: 'text/markdown;q=0.9,text/html;q=0.8' },
    });
    expect(negotiated.status).toBe(html.status);
    expect(negotiated.headers.get('content-type') ?? '').not.toContain('text/markdown');
  });

  test('a draft entry has no public page or companion', async () => {
    const page = await fetch(`${BASE}/posts/unpublished-sketch`);
    expect(page.status).toBe(404);
    const companion = await fetch(`${BASE}/posts/unpublished-sketch.md`);
    expect(companion.status).toBe(404);
  });

  test('EmDash serves its own robots.txt and sitemap', async () => {
    const robots = await fetch(`${BASE}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('Disallow: /_emdash/');
    const sitemap = await fetch(`${BASE}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
  });

  test('the build emitted no corpus bytes and no stray database at the repo root', () => {
    expect(existsSync(join(RECIPE, 'dist/client/llms.txt'))).toBe(false);
    expect(existsSync(join(REPO, 'data.db'))).toBe(false);
  });
});
