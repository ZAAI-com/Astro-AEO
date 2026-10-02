import { beforeAll, afterAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySchemaComponents } from '../test/contracts/schema-components.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/schema-tools/node');
const astroDir = join(REPO, 'node_modules/astro');
const astroPackage = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
const astroBin = join(astroDir, typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro);

let server;
let origin;
let logs = '';
beforeAll(async () => {
  execFileSync(process.execPath, [astroBin, 'build', '--root', FIXTURE], { cwd: REPO, stdio: 'pipe' });
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port) };
  for (const key of Object.keys(env)) if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  delete env.NODE_OPTIONS;
  server = spawn(process.execPath, [join(FIXTURE, 'dist/server/entry.mjs')], { cwd: REPO, env, stdio: 'pipe' });
  server.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  server.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).status === 200) return; } catch { /* Wait for the socket to accept connections. */ }
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${logs}`);
});
afterAll(() => server?.kill());

/** Ask the OS for an unused port, so readiness never depends on the adapter's log format. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}
test('renders every component on demand with advisory-only Google checks', async () => {
  const response = await fetch(origin);
  expect(response.status).toBe(200);
  verifySchemaComponents(await response.text());
  await expect.poll(() => logs).toContain('TechArticle: no Google profile is implemented by this checker');
  await expect.poll(() => logs).toContain('FAQPage: no Google profile is implemented by this checker');
});
test('rejects unsupported JavaScript Article types instead of emitting malformed data', async () => {
  for (const type of ['constructor', '__proto__', 'toString', 'Unknown']) {
    const before = logs.length;
    const response = await fetch(`${origin}/invalid-type?type=${type}`);
    // Astro can discover the component error after it has sent streaming headers.
    if (response.status === 500) expect(await response.text()).not.toContain('application/ld+json');
    else await expect(response.text()).rejects.toThrow();
    await expect.poll(() => logs.slice(before)).toContain('TypeError: ArticleJsonLd type must be Article, BlogPosting, or TechArticle');
  }
  expect((await fetch(origin)).status).toBe(200);
});
