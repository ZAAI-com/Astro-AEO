import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createIndexNowStateManifest,
  parseIndexNowAcknowledgment,
  parseIndexNowQueue,
  serializeIndexNowQueue,
  sha256,
} from '../src/build/indexnow-state.js';
import { IndexNowInvocationError, writePrivateFile } from './indexnow-io.js';
import { INDEXNOW_ENDPOINT, isPublicIp, retryDelay, submitIndexNow } from './indexnow-submit.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const KEY = 'valid-Key-123';
const fp = (name) => ({ url: `https://example.com/${name}`, fingerprint: sha256(name) });

function fixtureQueue(root, over = {}) {
  const queuePath = join(root, 'pending-v1.json');
  const origin = {
    origin: 'https://example.com',
    mode: 'private',
    strict: false,
    targetDigest: sha256('target'),
    key: { source: 'env', name: 'INDEXNOW_TEST_KEY' },
    operations: [{ url: 'https://example.com/a', operation: 'upsert', fingerprint: sha256('a') }],
    ...over,
  };
  writePrivateFile(queuePath, serializeIndexNowQueue({ version: 1, origins: [origin] }));
  return queuePath;
}

describe('indexnow submit', () => {
  test('verifies the key, posts a batch, advances acknowledgment, and clears pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const queuePath = fixtureQueue(root);
    const calls = [];
    const transport = {
      async request(url, options) {
        calls.push({ url, options });
        if (url === INDEXNOW_ENDPOINT) return { status: 202, headers: {}, body: '', url };
        return { status: 200, headers: {}, body: KEY, url };
      },
    };
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      transport,
    });
    expect(result).toMatchObject({ submitted: 1, pending: 0, strictFailure: false, warnings: [] });
    expect(calls.map((call) => call.url)).toEqual([
      `https://example.com/${KEY}.txt`,
      INDEXNOW_ENDPOINT,
    ]);
    expect(JSON.parse(calls[1].options.body)).toMatchObject({
      host: 'example.com',
      key: KEY,
      keyLocation: `https://example.com/${KEY}.txt`,
      urlList: ['https://example.com/a'],
    });
    const ack = parseIndexNowAcknowledgment(JSON.parse(readFileSync(result.acknowledgmentPath, 'utf8')));
    expect(ack.origins[0].acknowledged).toEqual([fp('a')]);
    expect(parseIndexNowQueue(JSON.parse(readFileSync(queuePath, 'utf8'))).origins[0].operations).toEqual([]);
    expect(readFileSync(queuePath, 'utf8')).not.toContain(KEY);
    expect(readFileSync(result.acknowledgmentPath, 'utf8')).not.toContain(KEY);
  });

  test('verifies a public deployment digest before posting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const state = createIndexNowStateManifest('https://example.com', [fp('a')], []);
    const queuePath = fixtureQueue(root, {
      mode: 'public',
      stateUrl: 'https://example.com/.well-known/astro-aeo-indexnow-v1.json',
      targetDigest: state.digest,
    });
    const calls = [];
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      transport: { async request(url) {
        calls.push(url);
        if (url.includes('.well-known')) return { status: 200, headers: {}, body: JSON.stringify(state), url };
        if (url === INDEXNOW_ENDPOINT) return { status: 200, headers: {}, body: '', url };
        return { status: 200, headers: {}, body: KEY, url };
      } },
    });
    expect(result.submitted).toBe(1);
    expect(calls[0]).toContain('.well-known');
    expect(calls.at(-1)).toBe(INDEXNOW_ENDPOINT);
  });

  test('retains work and applies strict mode on deployment mismatch without exposing secrets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const state = createIndexNowStateManifest('https://example.com', [fp('a')], []);
    const queuePath = fixtureQueue(root, {
      mode: 'public', strict: true,
      stateUrl: 'https://example.com/.well-known/astro-aeo-indexnow-v1.json',
      targetDigest: sha256('different'),
    });
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      transport: { async request(url) {
        return { status: 200, headers: {}, body: JSON.stringify(state), url };
      } },
    });
    expect(result).toMatchObject({ submitted: 0, pending: 1, strictFailure: true });
    expect(result.warnings.join('\n')).not.toContain(KEY);
  });

  test('retries only network, 429, and server failures with bounded delays', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const queuePath = fixtureQueue(root);
    let posts = 0;
    const delays = [];
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      sleep: async (delay) => { delays.push(delay); },
      now: () => 0,
      transport: { async request(url) {
        if (url !== INDEXNOW_ENDPOINT) return { status: 200, headers: {}, body: KEY, url };
        posts += 1;
        if (posts === 1) return { status: 429, headers: { 'retry-after': '99' }, body: '', url };
        if (posts === 2) return { status: 503, headers: {}, body: '', url };
        return { status: 200, headers: {}, body: '', url };
      } },
    });
    expect(result.submitted).toBe(1);
    expect(posts).toBe(3);
    expect(delays).toEqual([30_000, 2_000]);
    expect(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT', 0, 0)).toBe(30_000);
  });

  test('does not retry terminal 4xx and leaves the failed batch pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const queuePath = fixtureQueue(root);
    let posts = 0;
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      transport: { async request(url) {
        if (url !== INDEXNOW_ENDPOINT) return { status: 200, headers: {}, body: KEY, url };
        posts += 1;
        return { status: 422, headers: {}, body: '', url };
      } },
    });
    expect(posts).toBe(1);
    expect(result).toMatchObject({ submitted: 0, pending: 1, strictFailure: false });
  });

  test('batches at 10,000 and persists partial success safely', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const operations = Array.from({ length: 10_001 }, (_, index) => ({
      url: `https://example.com/p/${String(index).padStart(5, '0')}`,
      operation: 'upsert',
      fingerprint: sha256(String(index)),
    }));
    const queuePath = fixtureQueue(root, { operations });
    const batchSizes = [];
    const result = await submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      sleep: async () => {},
      transport: { async request(url, options) {
        if (url !== INDEXNOW_ENDPOINT) return { status: 200, headers: {}, body: KEY, url };
        batchSizes.push(JSON.parse(options.body).urlList.length);
        return batchSizes.length === 1
          ? { status: 200, headers: {}, body: '', url }
          : { status: 400, headers: {}, body: '', url };
      } },
    });
    expect(batchSizes).toEqual([10_000, 1]);
    expect(result).toMatchObject({ submitted: 10_000, pending: 1 });
    expect(parseIndexNowQueue(JSON.parse(readFileSync(queuePath, 'utf8'))).origins[0].operations).toHaveLength(1);
    expect(parseIndexNowAcknowledgment(JSON.parse(readFileSync(result.acknowledgmentPath, 'utf8'))).origins[0].acknowledged)
      .toHaveLength(10_000);
  });

  test('rejects malformed credentials before any network request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const queuePath = fixtureQueue(root);
    let calls = 0;
    await expect(submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: 'too short' },
      transport: { async request() { calls += 1; throw new Error(KEY); } },
    })).rejects.toBeInstanceOf(IndexNowInvocationError);
    expect(calls).toBe(0);
  });

  test('classifies private and reserved addresses as unsafe', () => {
    for (const value of [
      '127.0.0.1', '10.0.0.1', '169.254.1.1', '192.168.1.1',
      '198.51.100.1', '203.0.113.1', '::1', 'fc00::1', 'fe80::1',
      '2001:db8::1', '64:ff9b:1::1', '5f00::1', '::ffff:127.0.0.1',
    ]) {
      expect(isPublicIp(value), value).toBe(false);
    }
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
  });
});
