import { afterAll, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMP_PARENT = join(REPO, '.astro');
mkdirSync(TEMP_PARENT, { recursive: true });
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);
const roots = [];
const servers = new Set();

/** @param {string} root @param {string} pathname @param {string} contents */
function write(root, pathname, contents) {
  const target = join(root, pathname);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

// Outside src/, so toggling it does not churn the module graph.
/** @param {string} root */
function discoveryFlag(root) {
  return join(root, 'discovery-flag.txt');
}

/** @param {'startup'|'hot'} mode */
function createFixture(mode) {
  const root = mkdtempSync(join(TEMP_PARENT, `dev-dynamic-${mode}-`));
  roots.push(root);
  write(root, 'package.json', '{"type":"module"}\n');
  write(root, 'astro.config.mjs', `
import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://dynamic.example.test',
  trailingSlash: ${JSON.stringify(mode === 'startup' ? 'always' : 'ignore')},
  integrations: [aeo({
    pages: { devDynamicDiscovery: ${JSON.stringify(mode)} },
    schema: { corpus: { enabled: true } },
    corpus: { runtime: { maxPages: 30 } },
  })],
});
`);
  write(root, 'src/content.config.js', `
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  products: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/data/products' }) }),
};
`);
  write(root, 'src/data/products/one.md', '---\ntitle: Product One\n---\n\nProduct one body.\n');
  write(root, 'src/data/archive.mjs', "export const archiveSlugs = ['first', 'why?now#yes'];\n");
  // The controlled failure reads a flag file when getStaticPaths() runs, rather
  // than importing a module the test rewrites. Discovery calls getStaticPaths()
  // on every corpus request, so both the failure and the recovery take effect on
  // the next request without depending on the dev server's file watcher.
  writeFileSync(discoveryFlag(root), 'ok\n');
  write(root, 'src/pages/index.astro', `---\n---
<html><head><title>Home</title></head><body><main><h1>Home</h1></main></body></html>
`);
  write(root, 'src/pages/products/[slug].astro', `
---
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const products = await getCollection('products');
  return products.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}

const { entry } = Astro.props;
---
<html><head><title>{entry.data.title}</title></head><body><main><h1>{entry.data.title}</h1><p>Collection product body.</p></main></body></html>
`);
  write(root, 'src/pages/archive/[slug].astro', `
---
import { archiveSlugs } from '../../data/archive.mjs';
export function getStaticPaths() {
  return archiveSlugs.map((slug) => ({ params: { slug }, props: { slug } }));
}
const { slug } = Astro.props;
---
<html><head><title>Archive {slug}</title></head><body><main><h1>Archive {slug}</h1></main></body></html>
`);
  write(root, 'src/pages/failure/[slug].astro', `
---
import { readFileSync } from 'node:fs';
export function getStaticPaths() {
  if (readFileSync(${JSON.stringify(discoveryFlag(root))}, 'utf8').trim() === 'fail') {
    throw new Error('SECRET_CONTROLLED_DISCOVERY_FAILURE');
  }
  return [{ params: { slug: 'ok' } }];
}
---
<html><head><title>Failure control</title></head><body><main><h1>Failure control</h1></main></body></html>
`);
  // Keep the watched directories present while still adding the route files
  // themselves after startup. This avoids filesystem-watcher differences when
  // the entire fixture lives beneath the ignored .astro test-storage root.
  mkdirSync(join(root, 'src/pages/new'), { recursive: true });
  mkdirSync(join(root, 'src/pages/live'), { recursive: true });
  return root;
}

const addedRouteSource = `
---
export function getStaticPaths() {
  return [{ params: { slug: 'added' } }];
}
---
<html><head><title>Added route</title></head><body><main><h1>Added route body</h1></main></body></html>
`;

const onDemandRouteSource = `
---
export const prerender = false;
---
<html><head><title>Live route</title></head><body><main><h1>Live {Astro.params.slug}</h1></main></body></html>
`;

// The dev server colourises its output whenever CI is set. Strip the escape
// sequences once, on capture, so assertions and diagnostics read plain text.
const ANSI = /\u001B\[[0-9;]*m/g;

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

/** @param {string} root */
async function startServer(root) {
  const port = await freePort();
  const env = { ...process.env, ASTRO_DEV_BACKGROUND: '1' };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST') || key.startsWith('__VITEST') || key.startsWith('TINYPOOL')) {
      delete env[key];
    }
  }
  let output = '';
  const child = spawn(
    'node',
    [astroBin, 'dev', '--root', root, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] },
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
  }, 'dev server readiness');
  return { child, base, output: () => output };
}

/** @param {{ child: import('node:child_process').ChildProcess }} running */
async function stopServer(running) {
  const { child } = running;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
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

/** @param {string} base @param {string} pathname */
async function responseText(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  return { response, body: await response.text() };
}

afterAll(async () => {
  for (const child of servers) {
    await stopServer({ child });
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe.sequential('development dynamic-route discovery', () => {
  test('startup refreshes existing route data and requires restart for new route files', async () => {
    const root = createFixture('startup');
    let running = await startServer(root);

    let llms = await responseText(running.base, '/llms.txt');
    expect(llms.response.status).toBe(200);
    expect(llms.body).toContain('/products/one.md');
    expect(llms.body).toContain('/archive/first.md');
    expect(llms.body).toContain('/archive/why%3Fnow%23yes.md');
    expect(llms.body).not.toContain('/new/added.md');
    const full = await responseText(running.base, '/llms-full.txt');
    expect(full.response.status).toBe(200);
    expect(full.body).toContain('Collection product body.');
    expect(full.body).toContain('Archive why?now#yes');
    const schema = await responseText(running.base, '/schema/schema-map.xml');
    expect(schema.response.status).toBe(200);
    expect(schema.body).toContain('/products/one');
    const direct = await responseText(running.base, '/products/one.md');
    expect(direct.response.status).toBe(200);
    expect(direct.body).toContain('# Product One');
    const reservedDirect = await responseText(running.base, '/archive/why%3Fnow%23yes.md');
    expect(reservedDirect.response.status).toBe(200);
    expect(reservedDirect.body).toContain('# Archive why?now#yes');

    write(root, 'src/data/products/two.md', '---\ntitle: Product Two\n---\n\nProduct two body.\n');
    await waitFor(async () => (await responseText(running.base, '/llms.txt')).body
      .includes('/products/two.md'), 'content collection addition');

    write(root, 'src/data/archive.mjs', "export const archiveSlugs = ['first', 'second', 'why?now#yes'];\n");
    await waitFor(async () => (await responseText(running.base, '/llms.txt')).body
      .includes('/archive/second.md'), 'existing getStaticPaths dependency edit');

    write(root, 'src/pages/new/[slug].astro', addedRouteSource);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    llms = await responseText(running.base, '/llms.txt');
    expect(llms.response.status).toBe(200);
    expect(llms.body).not.toContain('/new/added.md');
    expect(running.output()).not.toContain('dynamic page routes require');

    await stopServer(running);
    running = await startServer(root);
    await waitFor(async () => (await responseText(running.base, '/llms.txt')).body
      .includes('/new/added.md'), 'startup restart route discovery');

    writeFileSync(discoveryFlag(root), 'fail\n');
    let lastFailureResponse = llms;
    await waitFor(async () => {
      lastFailureResponse = await responseText(running.base, '/llms.txt');
      return lastFailureResponse.response.status === 500;
    }, 'controlled discovery failure', () =>
      `${running.output()}\nLast response: ${lastFailureResponse.response.status} ${lastFailureResponse.body}`);
    const failed = await responseText(running.base, '/llms.txt');
    expect(failed.response.status).toBe(500);
    expect(failed.response.headers.get('cache-control')).toBe('no-store');
    expect(failed.body).toContain('/failure/[slug]');
    expect(failed.body).not.toContain('SECRET_CONTROLLED_DISCOVERY_FAILURE');
    expect(failed.body).not.toContain('/products/one.md');
    expect((await fetch(`${running.base}/`)).status).toBe(200);
    expect((await fetch(`${running.base}/products/one.md`)).status).toBe(200);

    writeFileSync(discoveryFlag(root), 'ok\n');
    let lastRecoveryResponse = failed;
    await waitFor(async () => {
      lastRecoveryResponse = await responseText(running.base, '/llms.txt');
      return lastRecoveryResponse.response.status === 200;
    }, 'discovery recovery', () =>
      `${running.output()}\nLast response: ${lastRecoveryResponse.response.status} ${lastRecoveryResponse.body}`);
    await stopServer(running);
  });

  test('hot tracks added and deleted dynamic route files without restart', async () => {
    const root = createFixture('hot');
    const running = await startServer(root);
    const routeFile = join(root, 'src/pages/new/[slug].astro');

    const initial = await responseText(running.base, '/llms.txt');
    expect(initial.response.status).toBe(200);
    expect(initial.body).not.toContain('/new/added.md');
    write(root, 'src/pages/new/[slug].astro', addedRouteSource);
    let lastAdditionResponse = initial;
    await waitFor(async () => {
      lastAdditionResponse = await responseText(running.base, '/llms.txt');
      return lastAdditionResponse.response.status === 200 &&
        lastAdditionResponse.body.includes('/new/added.md');
    }, 'hot route addition', () =>
      `${running.output()}\nLast response: ${lastAdditionResponse.response.status} ${lastAdditionResponse.body}`);
    rmSync(routeFile);
    await waitFor(async () => {
      const response = await responseText(running.base, '/llms.txt');
      return response.response.status === 200 && !response.body.includes('/new/added.md');
    }, 'hot route deletion');
    expect(running.output()).not.toContain('dynamic page routes require');

    const warning = 'on-demand dynamic page routes require pages.catalogs';
    write(root, 'src/pages/live/[slug].astro', onDemandRouteSource);
    await waitFor(async () => {
      await responseText(running.base, '/llms.txt');
      return running.output().includes(warning);
    }, 'hot on-demand route warning', running.output);
    await responseText(running.base, '/llms.txt');
    await responseText(running.base, '/llms.txt');
    expect(running.output().split(warning)).toHaveLength(2);
    await stopServer(running);
  });
});
