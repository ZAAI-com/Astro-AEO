import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createTcpServer, getDefaultAutoSelectFamily, setDefaultAutoSelectFamily, connect as tcpConnect } from 'node:net';
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
import {
  INDEXNOW_ENDPOINT,
  createSafeHttpsTransport,
  isPublicIp,
  retryDelay,
  submitIndexNow,
} from './indexnow-submit.js';

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

  test('retries a transport network error and succeeds on a later attempt', async () => {
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
        if (posts === 1) throw new Error('network down');
        return { status: 200, headers: {}, body: '', url };
      } },
    });
    expect(posts).toBe(2);
    expect(delays).toEqual([1_000]);
    expect(result).toMatchObject({ submitted: 1, pending: 0 });
  });

  test('gives up after three transport network errors and leaves the batch pending', async () => {
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
        throw new Error('network down');
      } },
    });
    expect(posts).toBe(3);
    expect(delays).toEqual([1_000, 2_000]);
    expect(result).toMatchObject({ submitted: 0, pending: 1 });
    expect(result.warnings.join('\n')).toContain('network request failed');
    expect(result.warnings.join('\n')).not.toContain(KEY);
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

  test('rejects encoded separators that escape the keyLocation prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-submit-'));
    roots.push(root);
    const queuePath = fixtureQueue(root, {
      keyLocation: '/keys/site.txt',
      operations: [{
        url: 'https://example.com/keys/a%2F..%2F..%2Fsecret',
        operation: 'upsert',
        fingerprint: sha256('secret'),
      }],
    });
    let calls = 0;
    await expect(submitIndexNow(queuePath, {
      projectRoot: root,
      env: { INDEXNOW_TEST_KEY: KEY },
      transport: { async request() { calls += 1; return { status: 200, headers: {}, body: KEY }; } },
    })).rejects.toThrow(/encoded path separator/u);
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


/**
 * A public address so the transport's own `isPublicIp` vetting runs unmodified. Nothing ever
 * connects to it: the tests below substitute loopback inside the injected `request`, preserving
 * whatever callback shape the pinned lookup produced.
 */
const PINNED = '93.184.216.34';

/** Start the transport and resolve with the request options it handed to the HTTPS request. */
function capturePinnedRequestOptions() {
  let capture;
  const captured = new Promise((resolve) => { capture = resolve; });
  const transport = createSafeHttpsTransport({
    lookup: async () => [{ address: PINNED, family: 4 }],
    request: (_url, options) => {
      capture(options);
      return { on() {}, setTimeout() {}, end() {}, destroy() {} };
    },
  });
  transport.request('https://pinned.example/key.txt', { method: 'GET' }).catch(() => {});
  return captured;
}

/** Invoke a lookup and collect every argument it passes back, so the shape itself is asserted. */
function callLookup(lookup, lookupOptions) {
  return new Promise((resolve) => {
    lookup('pinned.example', lookupOptions, (...args) => resolve(args));
  });
}

/** Close a listening server, ignoring an already-closed server. */
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve(undefined)));
}

/**
 * Drive the real transport end to end through Node's actual connect path against a local server.
 * The injected `request` only redirects the port and the pinned address to loopback; it keeps the
 * transport's own lookup callback shape, so Node validates exactly what the transport produced.
 */
async function requestThroughLocalServer(port, shapes) {
  const transport = createSafeHttpsTransport({
    lookup: async () => [{ address: PINNED, family: 4 }],
    request: (url, options, onResponse) => httpRequest({
      protocol: 'http:',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      port,
      method: options.method,
      headers: options.headers,
      lookup: (hostname, lookupOptions, callback) => {
        options.lookup(hostname, lookupOptions, (error, address, family) => {
          shapes.push({ all: lookupOptions?.all === true, address });
          if (Array.isArray(address)) callback(error, [{ address: '127.0.0.1', family: 4 }]);
          else callback(error, '127.0.0.1', 4);
        });
      },
    }, onResponse),
  });
  return transport.request('https://pinned.example/key.txt', { method: 'GET' });
}

describe('indexnow safe https transport', () => {
  test('answers the all-form lookup contract with an array of addresses', async () => {
    const options = await capturePinnedRequestOptions();
    expect(await callLookup(options.lookup, { all: true, hints: 1024 })).toEqual([
      null,
      [{ address: PINNED, family: 4 }],
    ]);
  });

  test('answers the legacy single-address lookup contract unchanged', async () => {
    const options = await capturePinnedRequestOptions();
    expect(await callLookup(options.lookup, {})).toEqual([null, PINNED, 4]);
    expect(await callLookup(options.lookup, { all: false })).toEqual([null, PINNED, 4]);
  });

  test('completes a request through the pinned lookup under happy eyeballs', async () => {
    const server = createHttpServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`${KEY} ${request.headers.host} ${request.url}`);
    });
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const shapes = [];
      const result = await requestThroughLocalServer(server.address().port, shapes);
      expect(result.status).toBe(200);
      expect(result.body).toContain(KEY);
      expect(result.url).toBe('https://pinned.example/key.txt');
      expect(shapes.some((shape) => shape.all && Array.isArray(shape.address))).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  test('keeps working when autoSelectFamily is explicitly enabled', async () => {
    const previous = getDefaultAutoSelectFamily();
    const tcp = createTcpServer((socket) => socket.end());
    const https = createHttpServer((_request, response) => response.end(KEY));
    try {
      setDefaultAutoSelectFamily(true);
      await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
      await new Promise((resolve) => https.listen(0, '127.0.0.1', resolve));

      // Pin Node's own contract, so a future default flip cannot silently re-hide the bug.
      const attempt = (lookup) => new Promise((resolve) => {
        const socket = tcpConnect({
          host: 'pinned.example',
          port: tcp.address().port,
          autoSelectFamily: true,
          lookup,
        });
        socket.on('connect', () => { socket.destroy(); resolve('connected'); });
        socket.on('error', (error) => resolve(error.code));
      });
      expect(await attempt((_host, _options, callback) => callback(null, '127.0.0.1', 4)))
        .toBe('ERR_INVALID_IP_ADDRESS');
      expect(await attempt((_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }])))
        .toBe('connected');

      const result = await requestThroughLocalServer(https.address().port, []);
      expect(result.status).toBe(200);
      expect(result.body).toBe(KEY);
    } finally {
      setDefaultAutoSelectFamily(previous);
      await closeServer(tcp);
      await closeServer(https);
    }
  });
});
