import { afterAll, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Astro's `findRouteToRewrite` commits to the first route whose pattern matches,
// and its only rejection branch reads `route.distURL`, which a development
// server never populates. `/[category]` therefore shadows `/[...slug]` for every
// path the latter owns, and every in-process rewrite to one of them throws.
// The build is unaffected, which is what the parity assertion below protects.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMP_PARENT = join(REPO, '.astro');
mkdirSync(TEMP_PARENT, { recursive: true });
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(
  astroDir,
  typeof astroBinField === 'string' ? astroBinField : astroBinField.astro,
);
// The dev server colourises its output whenever CI is set.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
/** @type {string[]} */
const roots = [];
const servers = new Set();

/** @param {string} root @param {string} pathname @param {string} contents */
function write(root, pathname, contents) {
  const target = join(root, pathname);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function createFixture() {
  const root = mkdtempSync(join(TEMP_PARENT, 'dev-rewrite-fallback-'));
  roots.push(root);
  write(root, 'package.json', '{"type":"module"}\n');
  write(root, 'astro.config.mjs', `
import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://overlap.example.test',
  trailingSlash: 'always',
  integrations: [aeo({ corpus: { runtime: { maxPages: 30 } } })],
});
`);
  write(root, 'src/pages/index.astro', `
<html><head><title>Home</title></head><body><h1>Home</h1></body></html>
`);
  // Sorted ahead of the catch-all and owns nothing: the candidate Astro picks.
  write(root, 'src/pages/[category]/index.astro', `---
export function getStaticPaths() {
  return [];
}
---
<html><head><title>Category</title></head><body><h1>Category</h1></body></html>
`);
  write(root, 'src/pages/[...slug].astro', `---
export function getStaticPaths() {
  return [{ params: { slug: 'alpha' } }, { params: { slug: 'beta' } }];
}
const { slug } = Astro.params;
---
<html><head><title>{slug}</title></head><body>
  <h1>{slug}</h1>
  <p>Body for {slug}.</p>
</body></html>
`);
  return root;
}

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  socket.close();
  await once(socket, 'close');
  return port;
}

/** @param {Record<string, string>} extra */
function childEnv(extra = {}) {
  const env = { ...process.env, ASTRO_DEV_BACKGROUND: '1', ...extra };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST') || key.startsWith('__VITEST') || key.startsWith('TINYPOOL')) {
      delete env[key];
    }
  }
  return env;
}

/** @param {string} root */
async function startServer(root) {
  const port = await freePort();
  let output = '';
  const child = spawn(
    'node',
    [astroBin, 'dev', '--root', root, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: REPO, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  servers.add(child);
  child.stdout.on('data', (chunk) => { output += String(chunk).replace(ANSI, ''); });
  child.stderr.on('data', (chunk) => { output += String(chunk).replace(ANSI, ''); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    try {
      return (await fetch(`${base}/`)).ok;
    } catch {
      return false;
    }
  }, 'dev server readiness', () => output);
  return { child, base, output: () => output };
}

/** @param {{ child: import('node:child_process').ChildProcess }} running */
async function stopServer(running) {
  const { child } = running;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  servers.delete(child);
}

/** @param {() => Promise<boolean>} predicate @param {string} label @param {() => string} [details] */
async function waitFor(predicate, label, details) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label}${details ? `\n${details()}` : ''}`);
}

/** @param {string} root */
async function build(root) {
  let output = '';
  const child = spawn('node', [astroBin, 'build', '--root', root], {
    cwd: REPO,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += String(chunk).replace(ANSI, ''); });
  child.stderr.on('data', (chunk) => { output += String(chunk).replace(ANSI, ''); });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`astro build failed\n${output}`);
  return output;
}

afterAll(async () => {
  for (const child of servers) await stopServer({ child });
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe.sequential('development rewrite fallback for overlapping dynamic routes', () => {
  test('aggregate corpora and companions still cover the shadowed routes', async () => {
    const root = createFixture();
    const running = await startServer(root);

    // Positive control: the ordinary request path never had this problem, so a
    // failure here would mean the fixture, not the fallback, is broken.
    const page = await fetch(`${running.base}/alpha/`);
    expect(page.status).toBe(200);

    const llms = await (await fetch(`${running.base}/llms.txt`)).text();
    expect(llms).toContain('/alpha.md');
    expect(llms).toContain('/beta.md');

    const full = await (await fetch(`${running.base}/llms-full.txt`)).text();
    expect(full).toContain('Body for alpha.');

    const companion = await fetch(`${running.base}/alpha.md`);
    expect(companion.status).toBe(200);
    expect(companion.headers.get('content-type')).toContain('text/markdown');
    expect(await companion.text()).toContain('Body for alpha.');

    await stopServer(running);
  });

  test('the build covers every page, so no development change moved build bytes', async () => {
    const root = createFixture();
    await build(root);
    const llms = readFileSync(join(root, 'dist', 'llms.txt'), 'utf8');
    expect(llms).toContain('/alpha.md');
    expect(llms).toContain('/beta.md');
    expect(readFileSync(join(root, 'dist', 'alpha.md'), 'utf8')).toContain(
      'Body for alpha.',
    );
  });
});
