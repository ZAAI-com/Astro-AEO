import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A separate root preserves the direct prerendered regression without hiding
// this mixed inventory's inability to render every page in the server bundle.
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/ssr-mixed');
const PORT = 4463;
const BASE = `http://127.0.0.1:${PORT}`;
const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(REPO, 'node_modules/astro', typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro);
let server;

function siteRequest(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port: PORT, path, method,
      headers: { host: 'mixed.example.com', ...headers },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

beforeAll(async () => {
  execFileSync('node', [astroBin, 'build', '--root', FIXTURE], { cwd: REPO, stdio: 'ignore' });
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) };
  for (const key of Object.keys(env)) {
    if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  server = spawn('node', [join(FIXTURE, 'dist/server/entry.mjs')], { cwd: REPO, env, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${BASE}/`);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Mixed SSR server did not become ready');
});

afterAll(() => {
  if (server) server.kill('SIGKILL');
});

describe('mixed prerendered and on-demand output', () => {
  test('direct prerendered Markdown remains a build asset and live Markdown still works', async () => {
    const built = readFileSync(join(FIXTURE, 'dist/client/static-page.md'), 'utf8');
    const staticPage = await fetch(`${BASE}/static-page.md`);
    expect(staticPage.status).toBe(200);
    expect(await staticPage.text()).toBe(built);
    expect(built).toContain('# Static Page');
    expect(built).toContain('Built ahead of time.');

    expect(existsSync(join(FIXTURE, 'dist/client/index.md'))).toBe(false);
    const livePage = await fetch(`${BASE}/index.md`);
    expect(livePage.status).toBe(200);
    expect(await livePage.text()).toContain('# Live Page');
  });

  test('an unavailable prerendered render fails the aggregate instead of silently omitting the page', async () => {
    // Astro does not bundle the prerendered page's component in this server.
    // Its failed rewrite is operational failure, not an intentional exclusion.
    for (const path of ['/llms.txt', '/llms-full.txt']) {
      expect(existsSync(join(FIXTURE, `dist/client${path}`))).toBe(false);
      for (const method of ['GET', 'HEAD']) {
        const response = await siteRequest(path, method, { 'if-none-match': '*' });
        expect(response.status).toBe(503);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).not.toContain('Live Page');
        expect(response.body).not.toContain('Static Page');
        expect(response.body).not.toContain('component instance');
        if (method === 'HEAD') expect(response.body).toBe('');
      }
    }
  });
});
