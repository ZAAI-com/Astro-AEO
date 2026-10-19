import { beforeAll, afterAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = join(repo, 'fixtures/starlight-versions-node');
const astroDir = join(repo, 'node_modules/astro');
const { bin } = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
let server;
let base;
let output = '';
const get = (pathname) => new Promise((resolve, reject) => {
  const request = httpRequest(`${base}/docs${pathname}`, { headers: { host: 'starlight-versions.example.test' } }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
  });
  request.on('error', reject);
  request.end();
});

beforeAll(async () => {
  execFileSync(process.execPath, [join(astroDir, typeof bin === 'string' ? bin : bin.astro), 'build', '--root', root],
    { cwd: repo, stdio: 'pipe' });
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  listener.close();
  await once(listener, 'close');
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port) };
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  server = spawn(process.execPath, [join(root, 'dist/server/entry.mjs')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { output += data; });
  server.stderr.on('data', (data) => { output += data; });
  for (let attempt = 0; ; attempt++) {
    try { if ((await get('/en/')).ok) break; } catch {}
    if (attempt === 100) throw new Error(`Starlight server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
});

test('runtime collection preserves explicit fallback content without exposing the marker', async () => {
  const visitor = await get('/fr/guides/fallback/');
  expect(visitor.status).toBe(200);
  expect(await visitor.text()).not.toContain('data-astro-aeo-marker');
  const companion = await get('/fr/guides/fallback.md');
  expect(companion.status).toBe(200);
  expect(await companion.text()).toContain('Untranslated authored source.');
  const archive = await get('/en/release-1/guides/install.md');
  expect(archive.status).toBe(200);
  const archiveText = await archive.text();
  expect(archiveText).toContain('Legacy English install.');
  expect(archiveText).toContain('- Version v2: <https://starlight-versions.example.test/docs/en/guides/install/>');
});

test('catalog-backed live versions exclude untranslated French fallbacks and match static topology', async () => {
  const response = await get('/llms/manifest.json');
  expect(response.status, `${output}\n${(await response.clone().text()).slice(0, 160)}`).toBe(200);
  const manifest = await response.json();
  expect(manifest.versions).toEqual({ current: 'v2', order: ['v2', 'v1'] });
  expect(manifest.pages.some((page) => page.id === '/fr/guides/fallback' || page.id.startsWith('/fr/release-1'))).toBe(false);
  const archive = await get('/en/v1/llms-full.txt');
  expect(archive.status).toBe(200);
  const archiveText = await archive.text();
  expect(archiveText).toContain('Legacy English install.');
  expect(archiveText).toContain('- Version v2: <https://starlight-versions.example.test/docs/en/guides/install/>');
  const french = await get('/fr/llms-full.txt');
  expect(french.status).toBe(200);
  const frenchText = await french.text();
  expect(frenchText).toContain('Installer français actuel.');
  expect(frenchText).not.toContain('Untranslated authored source.');
  const scoped = await get('/v1/llms/manifest.json');
  expect(scoped.status).toBe(200);
  expect((await scoped.json()).pages.every((page) => page.version === 'v1')).toBe(true);
});
