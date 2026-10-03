import { test, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { readdirSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url)); const root = join(repo, 'fixtures/analytics-node');
const astroDir = join(repo, 'node_modules/astro'); const { bin } = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
function files(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name), `${prefix}${entry.name}/`) : [[`${prefix}${entry.name}`, readFileSync(join(dir, entry.name), 'utf8')]]);
}
function build(mode) {
  const output = execFileSync(process.execPath, [join(astroDir, typeof bin === 'string' ? bin : bin.astro), 'build', '--root', root], { cwd: repo, env: { ...process.env, AEO_ANALYTICS_MODE: mode, ASTRO_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, stdio: 'pipe' }).toString();
  expect(output).not.toContain('astro-aeo:analytics-v1 '); // Prerender collection never records events.
  return files(join(root, 'dist/server'));
}
async function runServer(callback, extraEnv = {}) {
  const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening'); const port = listener.address().port; listener.close(); await once(listener, 'close');
  let output = ''; const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...extraEnv }; delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  const server = spawn(process.execPath, [join(root, 'dist/server/entry.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { output += data; }); server.stderr.on('data', (data) => { output += data; });
  const get = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}/docs${path}`, { method, headers: { host: 'analytics.example.test', ...headers } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    }); request.on('error', reject); request.end();
  });
  try {
    for (let i = 0; ; i++) { try { if ((await get('/')).ok) break; } catch {} if (i === 100) throw Error(output); await new Promise((resolve) => setTimeout(resolve, 50)); }
    await callback({ get, output: () => output });
  } finally { if (server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } }
}
const events = (output) => output.split('\n').filter((line) => line.startsWith('astro-aeo:analytics-v1 ')).map((line) => JSON.parse(line.slice('astro-aeo:analytics-v1 '.length)));
const delay = () => new Promise((resolve) => setTimeout(resolve, 50));

test('absent and disabled server bundles are byte-identical and analytics-free, with enabled positive control', async () => {
  const absent = build('absent'); const disabled = build('disabled'); expect(disabled).toEqual(absent);
  expect(absent.map(([, source]) => source).join('\n')).not.toMatch(/enabled-request-observation|analytics-v1|astro_aeo\.requests/);
  const enabled = build('console'); const source = enabled.map(([, source]) => source).join('\n'); expect(source).toContain('enabled-request-observation-v1'); expect(source).toContain('astro-aeo:analytics-v1'); expect(source).not.toContain('src/server/analytics-node.js');
  expect(files(join(root, 'dist/client')).filter(([path]) => /\.[cm]?js$/.test(path)).map(([, body]) => body).join('\n')).not.toMatch(/astro-aeo|analytics-v1/);
});
test('real middleware records bounded public observations once, excludes fan-out and keeps HTTP behavior', async () => {
  await runServer(async ({ get, output }) => {
    let start = events(output()).length;
    const dynamic = await get('/users/private-user?private-query=never', 'GET', { 'user-agent': 'GPTBot private-suffix', cookie: 'private-cookie', authorization: 'private-auth', referer: 'https://private-referrer.test' });
    expect(dynamic.status).toBe(200); await delay(); const observed = events(output()).slice(start); expect(observed).toHaveLength(1); expect(observed[0]).toMatchObject({ path: '/docs/users/[id]', crawler: { identity: 'GPTBot' }, representation: 'html', surface: 'node' });
    expect(JSON.stringify(observed)).not.toContain('private-');
    start = events(output()).length; const md = await get('/index.md'); expect(md.status).toBe(200); expect(await md.text()).toContain('Analytics home'); await delay(); expect(events(output()).slice(start)).toHaveLength(1);
    start = events(output()).length; const corpus = await get('/llms-full.txt'); expect(corpus.status, `${await corpus.clone().text()}\n${output()}`).toBe(200); await delay(); expect(events(output()).slice(start)).toHaveLength(1); expect(events(output()).at(-1)).toMatchObject({ pathKind: 'artifact' });
    start = events(output()).length; await get('/', 'POST'); await delay(); expect(events(output())).toHaveLength(start);
  });
});
test('generated user-module and Node JSONL sinks run only at request time', async () => {
  build('module'); await runServer(async ({ get, output }) => { await get('/'); await delay(); expect(output()).toContain('custom-analytics:'); expect(output()).not.toContain('runtime setup failed'); });
  await runServer(async ({ get, output }) => { const response = await get('/'); expect(response.status).toBe(200); expect(await response.text()).toContain('Analytics home'); await delay(); expect(output()).toContain('runtime setup failed'); expect(output()).not.toContain('private-runtime-details'); }, { AEO_SINK_RUNTIME_FAILURE: '1' });
  await runServer(async ({ get }) => { const response = await get('/'); expect(response.status).toBe(200); expect(await response.text()).toContain('Analytics home'); }, { AEO_SINK_RUNTIME_FAILURE: 'hang' });
  const path = join(root, '.astro/events-v1.jsonl'); rmSync(path, { force: true }); const source = build('jsonl').map(([, body]) => body).join('\n'); expect(source).toContain('node:fs'); expect(existsSync(path)).toBe(false);
  try { await runServer(async ({ get }) => { await get('/'); await delay(); }); expect(statSync(path).mode & 0o777).toBe(0o600); const entries = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse); expect(entries.length).toBeGreaterThan(0); expect(entries.every((event) => event.surface === 'node')).toBe(true); }
  finally { rmSync(path, { force: true }); }
});
