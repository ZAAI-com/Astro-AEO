import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createIndexNowStateManifest,
  parseIndexNowAcknowledgment,
  parseIndexNowQueue,
  serializeIndexNowPrepareInput,
  sha256,
} from '../src/build/indexnow-state.js';
import { writePrivateFile } from './indexnow-io.js';
import { prepareIndexNow } from './indexnow-prepare.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fp = (name) => ({ url: `https://example.com/${name}`, fingerprint: sha256(name) });

describe('indexnow prepare', () => {
  test('uses the private ledger and emits a deterministic key-free queue', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    const input = {
      version: 1,
      projectRoot: root,
      mode: 'private',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env', name: 'INDEXNOW_TEST_KEY' },
      origins: [{ origin: 'https://example.com' }],
      current: [fp('same'), fp('added')],
    };
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput(input));
    writePrivateFile(join(cache, 'ack-v1.json'), `${JSON.stringify({
      version: 1,
      origins: [{ origin: 'https://example.com', acknowledged: [fp('same'), fp('removed')] }],
    }, null, 2)}\n`);

    const result = await prepareIndexNow(join(root, 'dist'), { projectRoot: root });
    expect(result.operations).toBe(2);
    const queue = parseIndexNowQueue(JSON.parse(readFileSync(result.queuePath, 'utf8')));
    expect(queue.origins[0].operations).toEqual([
      { url: 'https://example.com/added', operation: 'upsert', fingerprint: sha256('added') },
      { url: 'https://example.com/removed', operation: 'remove' },
    ]);
    expect(readFileSync(result.queuePath, 'utf8')).not.toContain('INDEXNOW_TEST_KEY_VALUE');
  });

  test('falls back to the older same-origin public acknowledgment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: root,
      mode: 'public',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' },
      origins: [{ origin: 'https://example.com' }],
      current: [fp('same'), fp('new')],
    }));
    const deployed = createIndexNowStateManifest('https://example.com', [fp('old-current')], [fp('same')]);
    const fetch = async () => new Response(JSON.stringify(deployed), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const result = await prepareIndexNow(join(root, 'dist'), { projectRoot: root, fetch });
    const queue = parseIndexNowQueue(JSON.parse(readFileSync(result.queuePath, 'utf8')));
    expect(queue.origins[0].operations).toEqual([
      { url: 'https://example.com/new', operation: 'upsert', fingerprint: sha256('new') },
    ]);
    const ack = parseIndexNowAcknowledgment(JSON.parse(readFileSync(result.acknowledgmentPath, 'utf8')));
    expect(ack.origins[0].acknowledged).toEqual([fp('same')]);
  });

  test('targets the exact built public state while using older deployed acknowledgments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    const dist = join(root, 'dist');
    const statePath = join(dist, '.well-known', 'astro-aeo-indexnow-v1.json');
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: root,
      mode: 'public', submit: 'changed', strict: false, base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' }, origins: [{ origin: 'https://example.com' }], current: [fp('a')],
    }));
    const built = createIndexNowStateManifest('https://example.com', [fp('a')], [fp('newer-ack')]);
    writePrivateFile(statePath, `${JSON.stringify(built, null, 2)}\n`);
    const deployed = createIndexNowStateManifest('https://example.com', [fp('old')], [fp('older-ack')]);

    const result = await prepareIndexNow(dist, {
      projectRoot: root,
      fetch: async () => new Response(JSON.stringify(deployed), { status: 200 }),
    });
    const queue = parseIndexNowQueue(JSON.parse(readFileSync(result.queuePath, 'utf8')));
    expect(queue.origins[0].targetDigest).toBe(built.digest);
    expect(queue.origins[0].operations.map((item) => item.url)).toEqual([
      'https://example.com/a',
      'https://example.com/older-ack',
    ]);
  });

  test('finds a base-prefixed public URL at the root-relative dist path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    const dist = join(root, 'dist');
    const statePath = join(dist, '.well-known', 'astro-aeo-indexnow-v1.json');
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: root,
      mode: 'public',
      submit: 'changed',
      strict: false,
      base: '/docs',
      statePathname: '/docs/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' },
      origins: [{ origin: 'https://example.com' }],
      current: [fp('a')],
    }));
    const built = createIndexNowStateManifest('https://example.com', [fp('a')], []);
    writePrivateFile(statePath, `${JSON.stringify(built, null, 2)}\n`);

    const result = await prepareIndexNow(dist, {
      projectRoot: root,
      fetch: async () => new Response(JSON.stringify(built), { status: 200 }),
    });
    const queue = parseIndexNowQueue(JSON.parse(readFileSync(result.queuePath, 'utf8')));
    expect(queue.origins[0].targetDigest).toBe(built.digest);
  });

  test('keeps public fetch failure safe by queueing every current URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: root,
      mode: 'public', submit: 'changed', strict: false, base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' }, origins: [{ origin: 'https://example.com' }], current: [fp('a')],
    }));
    const result = await prepareIndexNow(join(root, 'dist'), {
      projectRoot: root,
      fetch: async () => { throw new Error('offline'); },
    });
    expect(result.warnings[0]).toMatch(/could not use deployed state/u);
    expect(result.operations).toBe(1);
  });

  test('rejects a malformed transferred private ledger', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    const cache = join(root, '.astro', 'aeo-cache', 'indexnow');
    writePrivateFile(join(cache, 'prepare-input-v1.json'), serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: root,
      mode: 'private',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' },
      origins: [{ origin: 'https://example.com' }],
      current: [fp('a')],
    }));
    writePrivateFile(join(cache, 'ack-v1.json'), '{}');
    await expect(prepareIndexNow(join(root, 'dist'), { projectRoot: root }))
      .rejects.toThrow(/invalid IndexNow acknowledgment ledger/u);
  });

  test('rejects --input with config source before importing config', async () => {
    await expect(prepareIndexNow('dist', { source: 'config', input: 'x' }))
      .rejects.toThrow(/only with --source cache/u);
  });

  test('supports an explicit config provider and executes it only in config mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-'));
    roots.push(root);
    let loaded = 0;
    const result = await prepareIndexNow(join(root, 'dist'), {
      source: 'config',
      projectRoot: root,
      async loadConfig() {
        loaded += 1;
        return {
          version: 1, projectRoot: root, mode: 'private', submit: 'changed', strict: false,
          base: '', statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
          key: { source: 'env' }, origins: [{ origin: 'https://example.com' }], current: [fp('a')],
        };
      },
    });
    expect(loaded).toBe(1);
    expect(result.operations).toBe(1);
  });
});
