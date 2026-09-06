import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  ASTRO_BIN,
  buildAdapter,
  fetchWithHost,
  fixture,
  startProcess,
  stopProcess,
  waitForReady,
} from './helpers.js';

// Issue #8 was reported against @astrojs/cloudflare, and its author could not confirm
// whether /llms-full.txt ever reached the worker. `astro preview` on this adapter runs
// real workerd through Miniflare with dist/client bound to ASSETS and neither
// not_found_handling nor run_worker_first set, so asset-before-worker precedence is
// exactly what a deployment does. This file proves the reported request now succeeds.
//
// It lives outside runtime.test.js on purpose: that file's shared describe body runs the
// full request contract against fixtures/adapters/shared, which this minimal fixture
// deliberately does not have.
const ORIGIN = 'http://127.0.0.1:4574';
const SITE_HOST = 'static-adapter.example.com';

// A dynamic route has no concrete pathname, so it never reaches the runtime inventory.
// If the worker had answered instead of the assets handler, these would be missing.
const BUILD_ONLY_PATHS = ['/items/alpha', '/items/beta'];

let server;

beforeAll(async () => {
  buildAdapter('static-cloudflare');
  server = startProcess(process.execPath, [
    ASTRO_BIN,
    'preview',
    '--ignore-lock',
    '--root',
    fixture('static-cloudflare'),
    '--host',
    '127.0.0.1',
    '--port',
    '4574',
  ], { env: { ASTRO_PREVIEW_BACKGROUND: '1' } });
  await waitForReady(ORIGIN, server);
}, 180000);

afterAll(async () => {
  await stopProcess(server?.child);
});

describe('static Cloudflare output serves the build corpus', () => {
  test.each(['/llms.txt', '/llms-full.txt'])('%s is served by the assets handler', async (path) => {
    const response = await fetchWithHost(`${ORIGIN}${path}`, SITE_HOST);
    // A 404 here is the failure the issue reported: no file for the assets handler to
    // find, and nothing behind it willing to answer.
    expect(response.status, `${path} status`).toBe(200);

    const body = await response.text();
    for (const pathname of [...BUILD_ONLY_PATHS, '/about']) {
      expect(body, `${path} is missing ${pathname}`).toContain(pathname);
    }
  });

  test('the on-demand endpoint still reaches the worker', async () => {
    const response = await fetchWithHost(`${ORIGIN}/api`, SITE_HOST);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
