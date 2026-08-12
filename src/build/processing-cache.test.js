import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { canonicalStringify, openProcessingCache } from './processing-cache.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'astro-aeo-processing-'));
  roots.push(root);
  return root;
}

function memoryWriter() {
  const writes = [];
  const deletes = [];
  return {
    writes,
    deletes,
    stagePrivateWrite(path, contents, options) { writes.push({ path, contents, options }); },
    stagePrivateDelete(path, options) { deletes.push({ path, options }); },
    apply() {
      for (const item of writes) {
        mkdirSync(join(item.path, '..'), { recursive: true });
        writeFileSync(item.path, typeof item.contents === 'function' ? item.contents() : item.contents, { mode: item.options.mode });
      }
      for (const item of deletes) rmSync(item.path, { force: true });
    },
  };
}

describe('processing cache', () => {
  test('canonicalizes object keys while preserving ordered arrays', () => {
    expect(canonicalStringify({ z: [2, 1], a: { d: 2, c: 1 } }))
      .toBe('{"a":{"c":1,"d":2},"z":[2,1]}');
  });

  test('persists private content-addressed blobs and reuses them warm', () => {
    const root = project();
    const cold = openProcessingCache(root, { enabled: true });
    const key = cold.key('extraction-v1', { body: 'private source' });
    expect(cold.get(key)).toBeUndefined();
    cold.put(key, { markdown: '# Secret' });
    const writer = memoryWriter();
    cold.stage(writer);
    writer.apply();
    cold.close();

    expect(lstatSync(cold.root).mode & 0o077).toBe(0);
    expect(writer.writes.every((item) => item.options.mode === 0o600)).toBe(true);
    const state = JSON.parse(readFileSync(cold.statePath, 'utf8'));
    expect(Object.values(state.entries)[0].blob).toMatch(/^[a-f\d]{64}$/);

    const warm = openProcessingCache(root, { enabled: true });
    expect(warm.get(key)).toEqual({ markdown: '# Secret' });
    expect(warm.stats).toMatchObject({ hits: 1, misses: 0 });
    warm.close();
  });

  test('fails cold and read-only for an active or foreign lock', () => {
    const root = project();
    const cacheRoot = join(root, '.astro', 'aeo-cache', 'processing-v1');
    mkdirSync(join(cacheRoot, 'blobs'), { recursive: true });
    writeFileSync(join(cacheRoot, 'lock'), `${JSON.stringify({ version: 1, hostname: hostname(), pid: process.pid, nonce: 'held' })}\n`);
    const diagnostics = [];
    const cache = openProcessingCache(root, { enabled: true, diagnostics });
    expect(cache.readOnly).toBe(true);
    expect(cache.get('x:y')).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'processing-cache-lock-unavailable' })]);
    cache.close();
  });

  test('rejects corrupt state without staging writes or deletion authority', () => {
    const root = project();
    const cacheRoot = join(root, '.astro', 'aeo-cache', 'processing-v1');
    mkdirSync(join(cacheRoot, 'blobs'), { recursive: true });
    writeFileSync(join(cacheRoot, 'state.json'), '{"version":1,"entries":{"bad":{"blob":"nope"}}}');
    const cache = openProcessingCache(root, { enabled: true });
    const writer = memoryWriter();
    cache.stage(writer);
    expect(cache.readOnly).toBe(true);
    expect(writer.writes).toEqual([]);
    expect(writer.deletes).toEqual([]);
    cache.close();
  });
});
