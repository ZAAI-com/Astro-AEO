import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url)); const root = join(repo, 'fixtures/analytics-node');
const astroDir = join(repo, 'node_modules/astro'); const { bin } = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
const events = (output) => output.split('\n').filter((line) => line.startsWith('astro-aeo:analytics-v1 ')).map((line) => JSON.parse(line.slice('astro-aeo:analytics-v1 '.length)));
test('development records console alongside a configured module and excludes collection/loopback re-entries', async () => {
  const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening'); const port = listener.address().port; listener.close(); await once(listener, 'close');
  const env = { ...process.env, AEO_ANALYTICS_MODE: 'module', ASTRO_DEV_BACKGROUND: '1' }; delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  let output = '';
  const server = spawn(process.execPath, [join(astroDir, typeof bin === 'string' ? bin : bin.astro), 'dev', '--root', root, '--host', '127.0.0.1', '--port', String(port)], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { output += data; }); server.stderr.on('data', (data) => { output += data; });
  const get = (path) => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}/docs${path}`, {}, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    }); request.on('error', reject); request.end();
  });
  try {
    for (let i = 0; ; i++) { try { if ((await get('/')).ok) break; } catch {} if (i === 120) throw Error(output); await new Promise((resolve) => setTimeout(resolve, 100)); }
    await new Promise((resolve) => setTimeout(resolve, 50)); expect(output).toContain('custom-analytics:'); expect(events(output).length).toBeGreaterThan(0);
    let start = events(output).length;
    const corpus = await get('/llms-full.txt'); expect(corpus.status, await corpus.clone().text()).toBe(200); await new Promise((resolve) => setTimeout(resolve, 100)); expect(events(output).slice(start)).toHaveLength(1);
    start = events(output).length; const md = await get('/users/listed.md'); expect(md.status).toBe(200); await new Promise((resolve) => setTimeout(resolve, 100)); expect(events(output).slice(start)).toHaveLength(1);
    expect(events(output).every((event) => event.surface === 'development')).toBe(true); expect(output).not.toContain('runtime setup failed');
  } finally { if (server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } }
});
