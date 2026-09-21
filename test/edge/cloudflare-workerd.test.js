import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ACCEPT_CONTRACT } from '../contracts/accept.js';
import { ASTRO_BIN, REPO, startProcess, stopProcess, waitForReady } from '../adapters/helpers.js';

// The Cloudflare handler in real workerd, in front of the real static build: the
// assets binding, streamed bodies and header handling are the platform's, not a mock's.
const FIXTURE = join(REPO, 'fixtures/edge-static');
const ORIGIN = 'http://127.0.0.1:4584';
let server;

beforeAll(async () => {
  const build = spawnSync(process.execPath, [ASTRO_BIN, 'build', '--root', FIXTURE], { cwd: REPO, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
  server = startProcess(join(REPO, 'node_modules/.bin/wrangler'), [
    'dev',
    '--config', join(FIXTURE, 'wrangler.jsonc'),
    '--ip', '127.0.0.1',
    '--port', '4584',
    '--inspector-port', '0',
    '--local',
  ], { env: { WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  await waitForReady(ORIGIN, server);
}, 180000);

afterAll(async () => {
  await stopProcess(server?.child);
});

/** @param {string} path @param {Record<string, string>} [headers] @param {string} [method] */
const get = (path, headers = {}, method = 'GET') => fetch(`${ORIGIN}${path}`, { method, headers, redirect: 'manual' });

describe('Cloudflare edge handler in workerd', () => {
  test.each(ACCEPT_CONTRACT)('Accept contract: $name', async ({ accept, markdown }) => {
    const response = await get('/guide/', accept === null ? {} : { accept });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toMatch(markdown ? /^text\/markdown/ : /^text\/html/);
    expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('accept');
    await response.arrayBuffer();
  });

  test('serves the companion bytes with a validator, and honors it', async () => {
    const response = await get('/guide/', { accept: 'text/markdown' });
    expect(await response.text()).toContain('# Guide');
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    const conditional = await get('/guide/', { accept: 'text/markdown', 'if-none-match': etag });
    expect(conditional.status).toBe(304);
  });

  test('answers HEAD without a body', async () => {
    const response = await get('/guide/', { accept: 'text/markdown' }, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(await response.text()).toBe('');
  });

  test('leaves unlisted and displaced pages, direct companions and assets alone', async () => {
    const displaced = await get('/displaced/', { accept: 'text/markdown' });
    expect(displaced.headers.get('content-type')).toMatch(/^text\/html/);
    expect(displaced.headers.get('vary') ?? '').not.toMatch(/accept(?!-)/i);
    expect(await (await get('/guide.md')).text()).toContain('# Guide');
    expect(await (await get('/displaced.md')).text()).toBe('project-owned file\n');
    expect((await get('/missing/', { accept: 'text/markdown' })).status).toBe(404);
  });
});
