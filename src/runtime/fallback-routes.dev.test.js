import { afterAll, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A generated artifact is a middleware claim, not a route, so Astro's router treats
// every artifact path as unmatched and falls back to `/404`. When a project declares
// `redirects: { '/404/': '/error/' }` that fallback is a redirect route, and Astro
// answers redirect routes in its routing layer before middleware dispatch, so
// pre-middleware is never invoked at all. Concrete fallback routes, the ones an
// adapter build already receives, give those paths a real match. The build stays
// adapter-gated, which the parity test below protects: a `prerender: false` route
// without an adapter would fail `astro build` outright.
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

/** @param {{ redirects?: boolean; adapter?: boolean }} [options] */
function createFixture(options = {}) {
  const root = mkdtempSync(join(TEMP_PARENT, 'dev-fallback-routes-'));
  roots.push(root);
  write(root, 'package.json', '{"type":"module"}\n');
  // No adapter, and deliberately no `src/pages/404.astro`: the redirect must be the
  // route Astro resolves for an unmatched path.
  write(root, 'astro.config.mjs', `
import { defineConfig } from 'astro/config';
${options.adapter ? "import node from '@astrojs/node';" : ''}
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://redirects.example.test',
  trailingSlash: 'always',
  ${options.adapter ? "adapter: node({ mode: 'standalone' })," : ''}
  ${options.redirects === false ? '' : "redirects: { '/404/': '/error/' },"}
  integrations: [aeo({
    site: { profile: { enabled: true } },
    corpus: { manifest: { enabled: true } },
    discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } },
  })],
});
`);
  write(root, 'src/pages/index.astro', `
<html><head><title>Home</title></head><body><h1>Home</h1></body></html>
`);
  write(root, 'src/pages/about.astro', `
<html><head><title>About</title></head><body>
  <h1>About</h1>
  <p>Redirect fixture about body.</p>
</body></html>
`);
  write(root, 'src/pages/error.astro', `
<html><head><title>Error</title></head><body><h1>Error</h1></body></html>
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

// `redirect: 'manual'` so the project's 301 surfaces as a status instead of the
// /error/ body, which would otherwise read as an ordinary 200.
/** @param {string} url @param {RequestInit} [init] */
function request(url, init = {}) {
  return fetch(url, { redirect: 'manual', ...init });
}

afterAll(async () => {
  for (const child of servers) await stopServer({ child });
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe.sequential('development artifacts survive a redirect-owned 404', () => {
  test('artifacts answer with their content instead of the 404 redirect', async () => {
    const root = createFixture();
    const running = await startServer(root);

    // Negative control, first: the fixture's redirect must really be live, or every
    // assertion below would pass for the wrong reason.
    const unknown = await request(`${running.base}/nope/`);
    expect(unknown.status).toBe(301);
    expect(unknown.headers.get('location')).toContain('/error/');

    const llms = await request(`${running.base}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(llms.headers.get('content-type')).toContain('text/plain');
    expect(await llms.text()).toContain('/about.md');

    const full = await request(`${running.base}/llms-full.txt`);
    expect(full.status).toBe(200);
    expect(await full.text()).toContain('Redirect fixture about body.');

    const manifest = await request(`${running.base}/llms/manifest.json`);
    expect(manifest.status).toBe(200);
    expect(JSON.parse(await manifest.text())).toMatchObject({ version: expect.anything() });

    const robots = await request(`${running.base}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('User-agent:');

    const profile = await request(`${running.base}/.well-known/domain-profile.json`);
    expect(profile.status).toBe(200);
    expect(JSON.parse(await profile.text())).toBeTypeOf('object');

    const companion = await request(`${running.base}/about.md`);
    expect(companion.status).toBe(200);
    expect(companion.headers.get('content-type')).toContain('text/markdown');
    expect(await companion.text()).toContain('Redirect fixture about body.');

    // An unclaimed `.md` path reaches the injected catch-all rather than the
    // development 404 page, so it is a bodyless 404 and still never the redirect.
    const missing = await request(`${running.base}/nope.md`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('');

    // The companion of a prerendered page cannot be produced by an in-process
    // rewrite from the on-demand catch-all, because Astro forbids that, so it is
    // answered through the development loopback. Nothing about that detour is a
    // failure the developer has to act on, so it must stay out of the terminal.
    expect(running.output()).not.toContain('could not be rendered');
    expect(running.output()).not.toContain('marked as prerendered');

    await stopServer(running);
  });

  test('the injected routes do not claim ownership away from Astro-AEO', async () => {
    const root = createFixture();
    // A project route at an artifact's served path must still win, which it cannot do
    // if the fallback routes registered as project claims: in that case the runtime
    // would decline the artifact and this body would never be reachable either.
    write(root, 'src/pages/llms-small.txt.js', `
export const prerender = true;
export function GET() {
  return new Response('project owned', { headers: { 'content-type': 'text/plain' } });
}
`);
    const running = await startServer(root);

    const owned = await request(`${running.base}/llms-small.txt`);
    expect(owned.status).toBe(200);
    expect(await owned.text()).toBe('project owned');

    // Positive control on the same server: Astro-AEO still owns what it claimed.
    const llms = await request(`${running.base}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(await llms.text()).toContain('/about.md');

    await stopServer(running);
  });

  // The injected catch-all has to render on demand to be dispatched at all, which puts
  // the whole development server in server mode and sends every internal rewrite to a
  // prerendered page through the loopback. That is a fair price for a project that
  // would otherwise get a redirect, and it must not be charged to anyone else.
  test('a project whose 404 is not a redirect keeps its in-process renders', async () => {
    const root = createFixture({ redirects: false });
    const running = await startServer(root);

    const before = running.output().length;
    const full = await request(`${running.base}/llms-full.txt`);
    expect(full.status).toBe(200);
    expect(await full.text()).toContain('Redirect fixture about body.');
    const companion = await request(`${running.base}/about.md`);
    expect(companion.status).toBe(200);
    expect(await companion.text()).toContain('Redirect fixture about body.');
    // A loopback re-request is an ordinary HTTP request and the dev server logs it.
    // An in-process rewrite is invisible, so an empty page log is the assertion.
    expect(running.output().slice(before)).not.toMatch(/\[200\]\s+\/about\//);
    expect(running.output()).not.toContain('could not be rendered');

    await stopServer(running);
  });

  // An adapter has always injected these routes, in development as well, so an
  // adapter development server has always served companions from an on-demand route.
  // Astro forbids that rewrite when the page is prerendered, which used to make the
  // companion 404 with the forbidden-rewrite text as its body.
  test('an adapter development server serves companions of prerendered pages', async () => {
    const root = createFixture({ adapter: true, redirects: false });
    const running = await startServer(root);

    const companion = await request(`${running.base}/about.md`);
    expect(companion.status).toBe(200);
    expect(companion.headers.get('content-type')).toContain('text/markdown');
    const body = await companion.text();
    expect(body).toContain('Redirect fixture about body.');
    expect(body).not.toContain('marked as prerendered');

    const llms = await request(`${running.base}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(await llms.text()).toContain('/about.md');
    expect(running.output()).not.toContain('could not be rendered');

    await stopServer(running);
  });

  test('the build is unchanged and still needs no adapter', async () => {
    const root = createFixture();
    // Injection stays adapter-gated for `astro build`: a `prerender: false` route
    // promotes the build to server output, which without an adapter fails outright.
    // This build succeeding is that assertion.
    await build(root);
    const dist = join(root, 'dist');
    expect(readFileSync(join(dist, 'llms.txt'), 'utf8')).toContain('/about.md');
    expect(readFileSync(join(dist, 'about.md'), 'utf8')).toContain('Redirect fixture about body.');
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toContain('User-agent:');
    expect(existsSync(join(dist, '_worker.js'))).toBe(false);
    expect(existsSync(join(dist, 'server'))).toBe(false);
  });
});
