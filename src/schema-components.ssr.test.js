import { beforeAll, afterAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { verifySchemaComponents } from '../test/contracts/schema-components.js';

let server;
let origin;
let logs = '';
beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build', '--root', 'fixtures/schema-tools/node'], { stdio: 'pipe' });
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0' };
  for (const key of Object.keys(env)) if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  delete env.NODE_OPTIONS;
  server = spawn(process.execPath, ['fixtures/schema-tools/node/dist/server/entry.mjs'], { env, stdio: 'pipe' });
  server.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  server.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    origin = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (origin) return;
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${logs}`);
});
afterAll(() => server?.kill());
test('renders every component on demand with advisory-only Google checks', async () => {
  const response = await fetch(origin);
  expect(response.status).toBe(200);
  verifySchemaComponents(await response.text());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(logs).toContain('TechArticle: no current documented Google profile');
  expect(logs).toContain('FAQPage: no current documented Google profile');
});
