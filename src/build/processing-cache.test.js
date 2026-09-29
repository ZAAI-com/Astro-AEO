import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';
import { extractionProducer } from './package-version.js';
import { canonicalStringify, describeProcessingCacheReset, openProcessingCache } from './processing-cache.js';

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

  test('reuses 10,000 unchanged pages and reconverts exactly one edited page', () => {
    const root = project();
    const pages = Array.from({ length: 10_000 }, (_, index) => ({ id: `/page-${index}`, body: `body-${index}` }));
    let conversions = 0;
    const cold = openProcessingCache(root, { enabled: true });
    for (const page of pages) {
      const key = cold.key('extraction-v1', page);
      if (cold.get(key) === undefined) {
        conversions++;
        cold.put(key, { markdown: '# Shared normalized payload' });
      }
    }
    expect(conversions).toBe(10_000);
    const writer = memoryWriter();
    cold.stage(writer);
    writer.apply();
    cold.close();

    conversions = 0;
    const warm = openProcessingCache(root, { enabled: true });
    for (const page of pages) {
      const key = warm.key('extraction-v1', page);
      if (warm.get(key) === undefined) conversions++;
    }
    expect(conversions).toBe(0);
    warm.close();

    pages[4_321] = { ...pages[4_321], body: 'one edited body' };
    conversions = 0;
    const edited = openProcessingCache(root, { enabled: true });
    for (const page of pages) {
      const key = edited.key('extraction-v1', page);
      if (edited.get(key) === undefined) {
        conversions++;
        edited.put(key, { markdown: '# Shared normalized payload' });
      }
    }
    expect(conversions).toBe(1);
    edited.close();
  });

  test('names astro-aeo and its extraction dependencies as the default producer', () => {
    const require = createRequire(import.meta.url);
    expect(extractionProducer()).toEqual({
      name: 'astro-aeo',
      version: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
      dependencies: {
        turndown: require('turndown/package.json').version,
        linkedom: require('linkedom/package.json').version,
      },
    });
  });

  test('resets writable after an upgrade and deletes the old blob', () => {
    const root = project();
    const cold = openProcessingCache(root, { enabled: true, producer: producer('1.4.0') });
    const oldKey = cold.key('extraction-v1', { body: 'source' });
    cold.put(oldKey, { markdown: '# Output from 1.4.0' });
    stageAndApply(cold);
    const oldBlob = blobPath(cold, oldKey);

    const upgraded = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(upgraded.readOnly).toBe(false);
    const newKey = upgraded.key('extraction-v1', { body: 'source' });
    expect(newKey).not.toBe(oldKey);
    expect(upgraded.get(newKey)).toBeUndefined();
    expect(upgraded.stats.hits).toBe(0);
    expect(upgraded.stats.invalidations).toMatchObject({ 'package-version': 1 });
    expect(upgraded.stats.reset).toEqual({ from: producer('1.4.0'), to: producer('1.5.0'), dropped: 1 });
    expect(describeProcessingCacheReset(upgraded.stats.reset)).toBe(
      'astro-aeo: processing cache reset after an extractor change (astro-aeo 1.4.0 -> 1.5.0); ' +
        '1 cached page(s) will be extracted again',
    );
    upgraded.put(newKey, { markdown: '# Output from 1.5.0' });
    const writer = stageAndApply(upgraded);
    expect(writer.deletes.map((item) => item.path)).toEqual([oldBlob]);
    expect(() => lstatSync(oldBlob)).toThrow();
    const state = JSON.parse(readFileSync(upgraded.statePath, 'utf8'));
    expect(state.producer).toEqual(producer('1.5.0'));
    expect(Object.keys(state.entries)).toEqual([newKey]);
  });

  test('never reuses a newer version\'s state after a downgrade', () => {
    const root = project();
    const newer = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    const newerKey = newer.key('extraction-v1', { body: 'source' });
    newer.put(newerKey, { markdown: '# Output from 1.5.0' });
    stageAndApply(newer);
    const newerBlob = blobPath(newer, newerKey);

    const older = openProcessingCache(root, { enabled: true, producer: producer('1.4.0') });
    expect(older.readOnly).toBe(false);
    const olderKey = older.key('extraction-v1', { body: 'source' });
    expect(olderKey).not.toBe(newerKey);
    expect(older.get(olderKey)).toBeUndefined();
    expect(older.get(newerKey)).toBeUndefined();
    expect(older.stats.hits).toBe(0);
    expect(describeProcessingCacheReset(/** @type {any} */ (older.stats.reset))).toBe(
      'astro-aeo: processing cache reset after an extractor change (astro-aeo 1.5.0 -> 1.4.0); ' +
        '1 cached page(s) will be extracted again',
    );
    older.put(olderKey, { markdown: '# Output from 1.4.0' });
    const writer = stageAndApply(older);
    expect(writer.deletes.map((item) => item.path)).toEqual([newerBlob]);
  });

  test('invalidates when only an extraction dependency version changes', () => {
    const root = project();
    const before = openProcessingCache(root, { enabled: true, producer: producer('1.5.0', { turndown: '7.2.3' }) });
    const beforeKey = before.key('extraction-v1', { body: 'source' });
    before.put(beforeKey, { markdown: '# Converted by turndown 7.2.3' });
    stageAndApply(before);

    const after = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    const afterKey = after.key('extraction-v1', { body: 'source' });
    expect(afterKey).not.toBe(beforeKey);
    expect(after.get(afterKey)).toBeUndefined();
    expect(after.readOnly).toBe(false);
    expect(describeProcessingCacheReset(/** @type {any} */ (after.stats.reset))).toBe(
      'astro-aeo: processing cache reset after an extractor change (turndown 7.2.3 -> 7.2.4); ' +
        '1 cached page(s) will be extracted again',
    );
    after.close();
  });

  test('resets a legacy state without a producer and stays writable', () => {
    const root = project();
    const { cacheRoot, blob } = seedLegacyState(root, { markdown: '# Legacy' });
    const cache = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(cache.readOnly).toBe(false);
    expect(cache.get('extraction-v1:legacy')).toBeUndefined();
    expect(cache.stats.invalidations).toMatchObject({ 'package-version': 1 });
    expect(cache.stats.reset).toEqual({ from: undefined, to: producer('1.5.0'), dropped: 1 });
    expect(describeProcessingCacheReset(/** @type {any} */ (cache.stats.reset))).toBe(
      'astro-aeo: processing cache reset after an extractor change (an earlier astro-aeo -> astro-aeo 1.5.0); ' +
        '1 cached page(s) will be extracted again',
    );
    const key = cache.key('extraction-v1', { body: 'source' });
    cache.put(key, { markdown: '# Fresh' });
    const writer = stageAndApply(cache);
    expect(writer.deletes.map((item) => item.path)).toEqual([join(cacheRoot, 'blobs', blob)]);
    const state = JSON.parse(readFileSync(cache.statePath, 'utf8'));
    expect(state.producer).toEqual(producer('1.5.0'));
    expect(Object.keys(state.entries)).toEqual([key]);
  });

  test('reports no reset for a legacy state with no entries', () => {
    const root = project();
    const cacheRoot = join(root, '.astro', 'aeo-cache', 'processing-v1');
    mkdirSync(join(cacheRoot, 'blobs'), { recursive: true });
    writeFileSync(join(cacheRoot, 'state.json'), JSON.stringify({ version: 1, entries: {} }));
    const cache = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(cache.readOnly).toBe(false);
    expect(cache.stats.reset).toBeUndefined();
    expect(cache.stats.invalidations).toEqual({});
    cache.close();
  });

  test('reports no reset when no state file exists', () => {
    const root = project();
    const warnings = [];
    const cache = openProcessingCache(root, {
      enabled: true,
      producer: producer('1.5.0'),
      logger: { warn: (message) => warnings.push(message) },
    });
    expect(cache.readOnly).toBe(false);
    expect(cache.stats.reset).toBeUndefined();
    expect(warnings).toEqual([]);
    cache.close();
  });

  test('resets writable instead of going read-only for a malformed producer', () => {
    const root = project();
    const { blob } = seedLegacyState(root, { markdown: '# Malformed producer' }, { name: 'astro-aeo', version: 42 });
    const diagnostics = [];
    const cache = openProcessingCache(root, { enabled: true, diagnostics, producer: producer('1.5.0') });
    expect(cache.readOnly).toBe(false);
    expect(diagnostics).toEqual([]);
    expect(cache.stats.reset).toEqual({ from: undefined, to: producer('1.5.0'), dropped: 1 });
    const writer = stageAndApply(cache);
    expect(writer.deletes.map((item) => item.path)).toEqual([join(cache.blobsRoot, blob)]);
    expect(JSON.parse(readFileSync(cache.statePath, 'utf8')).producer).toEqual(producer('1.5.0'));
  });

  test('sweeps entries the session did not touch', () => {
    const root = project();
    const { keep, keepBlob, dropBlob } = seedTwoEntries(root);

    const second = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(second.stats.reset).toBeUndefined();
    expect(second.get(keep)).toEqual({ markdown: '# Keep' });
    const writer = stageAndApply(second);
    expect(writer.deletes.map((item) => item.path)).toEqual([dropBlob]);
    const state = JSON.parse(readFileSync(second.statePath, 'utf8'));
    expect(Object.keys(state.entries)).toEqual([keep]);
    expect(readdirSync(second.blobsRoot)).toEqual([keepBlob.slice(second.blobsRoot.length + 1)]);
  });

  test('keeps untouched entries when the sweep is off', () => {
    const root = project();
    const { keep, drop } = seedTwoEntries(root);

    const second = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(second.get(keep)).toEqual({ markdown: '# Keep' });
    const writer = stageAndApply(second, { sweep: false });
    expect(writer.deletes).toEqual([]);
    const state = JSON.parse(readFileSync(second.statePath, 'utf8'));
    expect(Object.keys(state.entries).sort()).toEqual([keep, drop].sort());

    const third = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    expect(third.get(keep)).toEqual({ markdown: '# Keep' });
    expect(third.get(drop)).toEqual({ markdown: '# Drop' });
    third.close();
  });

  test('stays warm across builds with the same producer', () => {
    const root = project();
    const pages = ['/a', '/b', '/c'].map((id) => ({ id, body: `body ${id}` }));
    const cold = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    for (const page of pages) cold.put(cold.key('extraction-v1', page), { markdown: `# ${page.id}` });
    stageAndApply(cold);

    let conversions = 0;
    const warm = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
    for (const page of pages) {
      if (warm.get(warm.key('extraction-v1', page)) === undefined) conversions++;
    }
    expect(conversions).toBe(0);
    expect(warm.stats.reset).toBeUndefined();
    const writer = stageAndApply(warm);
    expect(writer.deletes).toEqual([]);
  });
});

/**
 * @param {string} version
 * @param {Partial<{ turndown: string; linkedom: string }>} [dependencies]
 */
function producer(version, dependencies = {}) {
  return /** @type {const} */ ({
    name: 'astro-aeo',
    version,
    dependencies: { turndown: '7.2.4', linkedom: '0.18.13', ...dependencies },
  });
}

/** Stage, apply, and close a session, returning the writer for assertions. */
function stageAndApply(cache, stageOptions) {
  const writer = memoryWriter();
  cache.stage(writer, stageOptions);
  writer.apply();
  cache.close();
  return writer;
}

function blobPath(cache, key) {
  return join(cache.blobsRoot, JSON.parse(readFileSync(cache.statePath, 'utf8')).entries[key].blob);
}

/** Write two entries with distinct payloads, so each has its own blob. */
function seedTwoEntries(root) {
  const first = openProcessingCache(root, { enabled: true, producer: producer('1.5.0') });
  const keep = first.key('extraction-v1', { body: 'keep' });
  const drop = first.key('extraction-v1', { body: 'drop' });
  first.put(keep, { markdown: '# Keep' });
  first.put(drop, { markdown: '# Drop' });
  stageAndApply(first);
  return { keep, drop, keepBlob: blobPath(first, keep), dropBlob: blobPath(first, drop) };
}

/** Seed a state as 1.4.0 wrote it (no producer), or with the given producer. */
function seedLegacyState(root, payload, storedProducer) {
  const cacheRoot = join(root, '.astro', 'aeo-cache', 'processing-v1');
  mkdirSync(join(cacheRoot, 'blobs'), { recursive: true });
  const bytes = canonicalStringify(payload);
  const blob = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(cacheRoot, 'blobs', blob), bytes);
  writeFileSync(
    join(cacheRoot, 'state.json'),
    JSON.stringify({
      version: 1,
      ...(storedProducer ? { producer: storedProducer } : {}),
      entries: { 'extraction-v1:legacy': { blob } },
    }),
  );
  return { cacheRoot, blob };
}
