// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { serializeDeploymentFacts } from '../src/build/deployment-facts.js';
import { prefersMarkdown } from '../src/runtime/negotiate.js';
import { DoctorInvocationError, runDoctor } from './doctor.js';
import { runFix } from './fix/index.js';

const BIN = resolve('bin/astro-aeo.js');
/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** @param {Record<string, string>} files @param {Record<string, unknown> | null} [facts] */
function project(files, facts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'astro-aeo-doctor-'));
  roots.push(root);
  const all = { ...files };
  if (facts) {
    all['.astro/aeo-cache/deployment-v1.json'] = serializeDeploymentFacts({
      output: 'static', adapter: null, base: '', buildFormat: 'directory', trailingSlash: 'ignore',
      negotiation: 'off', edgeProvider: null, ownership: [], .../** @type {any} */ (facts),
    });
  }
  for (const [name, contents] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  return root;
}

/** @param {import('./doctor.js').DoctorCheck[]} checks */
const statuses = (checks) => Object.fromEntries(checks.map((check) => [check.id, check.status]));
const MANIFEST = JSON.stringify({ version: 1, provider: 'cloudflare', mode: 'response', base: '/', routes: [{ html: '/', markdown: '/index.md' }] });

describe('doctor, local files only', () => {
  test('reports a project that was never built', async () => {
    const result = await runDoctor([project({}, null)]);
    expect(statuses(result.checks)).toEqual({ 'build-facts': 'missing', 'markdown-mime': 'unverified', negotiation: 'unverified' });
    expect(result.exitCode).toBe(1);
  });

  test.each([
    ['netlify', { 'netlify.toml': '' }],
    ['cloudflare', { 'wrangler.toml': '' }],
    ['vercel', { 'vercel.json': '{}' }],
    ['render', { 'render.yaml': 'services:\n  - type: web\n    name: site\n    runtime: static\n' }],
  ])('%s: missing before fix, and only ever unverified after it', async (_provider, files) => {
    const root = project(files);
    expect(statuses((await runDoctor([root])).checks)['markdown-mime']).toBe('missing');
    await runFix([root, '--write']);
    const after = await runDoctor([root]);
    // Correct local configuration is never reported as a verified deployment.
    expect(statuses(after.checks)).toEqual({ 'build-facts': 'configured', 'markdown-mime': 'unverified', negotiation: 'configured' });
    expect(after.exitCode).toBe(0);
    expect(after.output).toContain('Pass --url');
  });

  test('reports a file fix would refuse as conflicting, with the reason', async () => {
    const result = await runDoctor([project({ 'vercel.json': '{ // comment\n}' })]);
    expect(result.checks.find((check) => check.id === 'markdown-mime')).toMatchObject({ status: 'conflicting', message: expect.stringContaining('not valid JSON') });
    expect(statuses((await runDoctor([project({ 'vercel.json': '{}', 'netlify.toml': '' })])).checks)['markdown-mime']).toBe('conflicting');
  });

  test('negotiation on a static site needs a provider, a manifest and a handler', async () => {
    const negotiation = async (/** @type {Record<string, string>} */ files, /** @type {Record<string, unknown>} */ facts) =>
      (await runDoctor([project(files, facts)])).checks.find((check) => check.id === 'negotiation');
    expect(await negotiation({}, { negotiation: 'response' })).toMatchObject({ status: 'missing', message: expect.stringContaining('nothing that can negotiate') });
    const facts = { negotiation: 'response', edgeProvider: 'cloudflare' };
    expect(await negotiation({}, facts)).toMatchObject({ status: 'missing', message: expect.stringContaining('no valid edge manifest') });
    const manifest = { 'dist/.well-known/astro-aeo-edge-v1.json': MANIFEST };
    expect(await negotiation(manifest, facts)).toMatchObject({ status: 'missing', message: expect.stringContaining('no cloudflare handler') });
    const handler = { 'functions/_middleware.js': "import { createCloudflareHandler } from 'astro-aeo/edge/cloudflare';" };
    expect(await negotiation({ ...manifest, ...handler }, facts)).toMatchObject({ status: 'unverified' });
    expect(await negotiation({ ...manifest, 'functions/_middleware.js': 'export const onRequest = () => {};' }, facts)).toMatchObject({ status: 'missing' });
    expect(await negotiation({}, { negotiation: 'response', adapter: '@astrojs/node', output: 'server' })).toMatchObject({ status: 'unverified' });
  });

  test('honors a base in the manifest location and finds a Netlify edge function by content', async () => {
    const root = project({
      'dist/docs/.well-known/astro-aeo-edge-v1.json': MANIFEST,
      'netlify/edge-functions/aeo.js': "import { createNetlifyHandler } from 'astro-aeo/edge/netlify';",
    }, { negotiation: 'redirect', edgeProvider: 'netlify', base: '/docs' });
    expect(statuses((await runDoctor([root])).checks).negotiation).toBe('unverified');
  });
});

describe('doctor --url', () => {
  const html = '<!doctype html><html lang="en"><head><title>t</title><link rel="alternate" type="text/markdown" href="/index.md"></head><body></body></html>';

  /** A deployment that negotiates correctly in `mode`, serving `.md` as `mime`. @param {'off'|'response'|'redirect'} mode @param {string} mime */
  function deployment(mode, mime) {
    /** @type {Request[]} */
    const seen = [];
    const fetch = /** @type {typeof globalThis.fetch} */ (async (input, init) => {
      const request = new Request(input, init);
      seen.push(request);
      const path = new URL(request.url).pathname;
      if (path === '/index.md') return new Response('# t', { headers: { 'content-type': mime } });
      const vary = mode === 'off' ? {} : { vary: 'Accept' };
      if (mode !== 'off' && prefersMarkdown(request.headers.get('accept'))) {
        if (mode === 'redirect') return new Response(null, { status: 303, headers: { location: '/index.md', ...vary } });
        if (request.headers.get('if-none-match') === '"e"') return new Response(null, { status: 304, headers: vary });
        return new Response(request.method === 'HEAD' ? null : '# t', { headers: { 'content-type': 'text/markdown; charset=utf-8', etag: '"e"', ...vary } });
      }
      return new Response(html, { headers: { 'content-type': 'text/html', ...vary } });
    });
    return { fetch, seen };
  }

  test.each(/** @type {const} */ (['off', 'response', 'redirect']))('verifies a correct deployment with negotiation %s', async (mode) => {
    const site = deployment(mode, 'text/markdown; charset=utf-8');
    const root = project({ 'netlify.toml': '' }, { negotiation: mode, adapter: mode === 'off' ? null : '@astrojs/node' });
    const result = await runDoctor([root, '--url', 'https://example.com/'], { fetch: site.fetch });
    expect(statuses(result.checks)).toEqual({ 'build-facts': 'configured', 'markdown-mime': 'configured', negotiation: 'configured' });
    expect(result.exitCode).toBe(0);
    // Bounded and anonymous: a fixed request count, same origin, no credentials.
    expect(site.seen.length).toBeLessThan(40);
    for (const request of site.seen) {
      expect(new URL(request.url).origin).toBe('https://example.com');
      expect(request.headers.get('cookie')).toBeNull();
      expect(request.headers.get('authorization')).toBeNull();
    }
  });

  test('a deployment overrules correct local files', async () => {
    const root = project({ 'netlify.toml': '' }, { negotiation: 'response', adapter: '@astrojs/node' });
    await runFix([root, '--write']);
    const result = await runDoctor([root, '--url', 'https://example.com/'], { fetch: deployment('off', 'text/plain').fetch });
    expect(statuses(result.checks)).toMatchObject({ 'markdown-mime': 'conflicting', negotiation: 'conflicting' });
    expect(result.exitCode).toBe(1);
  });

  test('flags negotiation the project did not ask for', async () => {
    const result = await runDoctor([project({}), '--url', 'https://example.com/'], { fetch: deployment('response', 'text/markdown').fetch });
    expect(statuses(result.checks).negotiation).toBe('conflicting');
  });

  test.each([
    ['https://user:pw@example.com/', /without credentials/],
    ['ftp://example.com/', /http\(s\)/],
    ['not a url', /not a valid URL/],
  ])('refuses the target %s', async (url, message) => {
    await expect(runDoctor([project({}), '--url', url])).rejects.toThrow(message);
  });

  test('an unreachable or failing page is an invocation error, not a finding', async () => {
    const down = /** @type {typeof globalThis.fetch} */ (async () => { throw new Error('ECONNREFUSED'); });
    await expect(runDoctor([project({}), '--url', 'https://example.com/'], { fetch: down })).rejects.toBeInstanceOf(DoctorInvocationError);
    const notFound = /** @type {typeof globalThis.fetch} */ (async () => new Response('', { status: 404 }));
    await expect(runDoctor([project({}), '--url', 'https://example.com/'], { fetch: notFound })).rejects.toThrow(/HTTP 404/);
  });
});

describe('doctor and fix through the CLI', () => {
  test('exit codes: 1 for a missing check, 0 once fixed, 2 for a bad invocation or a refusal', () => {
    const root = project({ 'vercel.json': '{}' });
    const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    expect(run(['doctor', root]).status).toBe(1);
    const dry = run(['fix', root]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(run(['fix', root, '--write']).status).toBe(0);
    const doctor = run(['doctor', root, '--json']);
    expect(doctor.status).toBe(0);
    expect(JSON.parse(doctor.stdout).checks.map((/** @type {any} */ check) => check.status)).toEqual(['configured', 'unverified', 'configured']);
    expect(run(['doctor', root, '--bogus']).status).toBe(2);
    expect(run(['doctor', 'no-such-dir']).status).toBe(2);
    expect(run(['fix', root, '--provider', 'fastly']).status).toBe(2);
    const refused = run(['fix', project({})]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('no supported provider configuration');
  });
});
