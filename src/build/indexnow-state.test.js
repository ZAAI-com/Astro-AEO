import { describe, expect, test } from 'vitest';
import {
  acknowledgeIndexNowOperations,
  createIndexNowStateManifest,
  fingerprintIndexNowPage,
  parseIndexNowPrepareInput,
  parseIndexNowQueue,
  parseIndexNowStateManifest,
  prepareIndexNowOrigin,
  serializeIndexNowStateManifest,
  sha256,
  validateRootPath,
} from './indexnow-state.js';

const fp = (value) => ({ url: `https://example.com/${value}`, fingerprint: sha256(value) });

describe('IndexNow deterministic state', () => {
  test('sorts state and hashes canonical content without a wall clock', () => {
    const a = createIndexNowStateManifest('https://example.com', [fp('b'), fp('a')], [fp('old')]);
    const b = createIndexNowStateManifest('https://example.com/', [fp('a'), fp('b')], [fp('old')]);
    expect(a).toEqual(b);
    expect(a.current.urls.map((item) => item.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(a.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(serializeIndexNowStateManifest(a)).toBe(`${JSON.stringify(a, null, 2)}\n`);
    expect(serializeIndexNowStateManifest(a)).not.toContain('generatedAt');
    expect(parseIndexNowStateManifest(a, 'https://example.com')).toEqual(a);
  });

  test('rejects changed nested and top-level digests', () => {
    const state = createIndexNowStateManifest('https://example.com', [fp('a')], []);
    expect(() => parseIndexNowStateManifest({
      ...state,
      current: { ...state.current, urls: [fp('b')] },
    }, state.origin)).toThrow(/current digest/u);
    expect(() => parseIndexNowStateManifest({ ...state, digest: sha256('wrong') }, state.origin))
      .toThrow(/manifest digest/u);
  });

  test('fingerprints semantic state while normalizing line endings and object keys', () => {
    const one = fingerprintIndexNowPage({
      canonicalUrl: 'https://example.com/a',
      markdown: 'one\r\ntwo',
      metadata: { z: 1, a: 2 },
    });
    const two = fingerprintIndexNowPage({
      canonicalUrl: 'https://example.com/a',
      markdown: 'one\ntwo',
      metadata: { a: 2, z: 1 },
    });
    expect(one).toBe(two);
    expect(fingerprintIndexNowPage({ canonicalUrl: 'https://example.com/a', markdown: 'changed' }))
      .not.toBe(one);
    expect(fingerprintIndexNowPage({
      canonicalUrl: 'https://example.com/a', markdown: 'one\ntwo', metadata: { a: 2, z: 1 }, language: 'fr',
    })).not.toBe(one);
  });

  test('prepares changed, added, removed, all, and stateless operation sets', () => {
    const current = [fp('same'), fp('changed'), fp('added')];
    const acknowledged = [
      fp('same'),
      { ...fp('changed'), fingerprint: sha256('old-changed') },
      fp('removed'),
    ];
    expect(prepareIndexNowOrigin({
      origin: 'https://example.com', current, acknowledged, mode: 'private', submit: 'changed',
    }).operations).toEqual([
      { url: 'https://example.com/added', operation: 'upsert', fingerprint: sha256('added') },
      { url: 'https://example.com/changed', operation: 'upsert', fingerprint: sha256('changed') },
      { url: 'https://example.com/removed', operation: 'remove' },
    ]);
    expect(prepareIndexNowOrigin({
      origin: 'https://example.com', current, acknowledged, mode: 'private', submit: 'all',
    }).operations).toHaveLength(4);
    const stateless = prepareIndexNowOrigin({
      origin: 'https://example.com', current, acknowledged, mode: 'stateless', submit: 'changed',
    });
    expect(stateless.operations).toHaveLength(3);
    expect(stateless.operations.every((item) => item.operation === 'upsert')).toBe(true);
    expect(stateless.warning).toMatch(/treated as "all"/u);
  });

  // A removal is inferred from absence alone. When the build could not see every page,
  // absence stops being evidence, but a page it did see and fingerprint is still news.
  test('withholds removals but keeps upserts when the inventory is incomplete', () => {
    const current = [fp('same'), fp('changed'), fp('added')];
    const acknowledged = [
      fp('same'),
      { ...fp('changed'), fingerprint: sha256('old-changed') },
      fp('removed'),
    ];
    const operations = prepareIndexNowOrigin({
      origin: 'https://example.com',
      current,
      acknowledged,
      mode: 'private',
      submit: 'changed',
      inventoryComplete: false,
    }).operations;

    expect(operations).toEqual([
      { url: 'https://example.com/added', operation: 'upsert', fingerprint: sha256('added') },
      { url: 'https://example.com/changed', operation: 'upsert', fingerprint: sha256('changed') },
    ]);
    expect(operations.some((item) => item.operation === 'remove')).toBe(false);
  });

  test('does not resurrect a removal queued by an earlier build while inventory is incomplete', () => {
    const priorPending = [{ url: 'https://example.com/removed', operation: /** @type {const} */ ('remove') }];
    const shared = {
      origin: 'https://example.com',
      current: [fp('same')],
      acknowledged: [fp('same'), fp('removed')],
      mode: /** @type {const} */ ('private'),
      submit: /** @type {const} */ ('changed'),
      priorPending,
    };

    expect(prepareIndexNowOrigin(shared).operations)
      .toEqual([{ url: 'https://example.com/removed', operation: 'remove' }]);
    expect(prepareIndexNowOrigin({ ...shared, inventoryComplete: false }).operations).toEqual([]);
  });

  test('treats an absent inventoryComplete as complete', () => {
    const shared = {
      origin: 'https://example.com',
      current: [fp('same')],
      acknowledged: [fp('same'), fp('removed')],
      mode: /** @type {const} */ ('private'),
      submit: /** @type {const} */ ('changed'),
    };
    expect(prepareIndexNowOrigin(shared).operations).toHaveLength(1);
    expect(prepareIndexNowOrigin({ ...shared, inventoryComplete: true }).operations).toHaveLength(1);
  });

  test('acknowledges successful batches without losing other state', () => {
    const result = acknowledgeIndexNowOperations(
      [fp('keep'), fp('remove')],
      [
        { url: 'https://example.com/remove', operation: 'remove' },
        { url: 'https://example.com/add', operation: 'upsert', fingerprint: sha256('new') },
      ],
      'https://example.com',
    );
    expect(result).toEqual([
      { url: 'https://example.com/add', fingerprint: sha256('new') },
      fp('keep'),
    ]);
  });

  test('strictly parses secret-free input and queue records', () => {
    const input = parseIndexNowPrepareInput({
      version: 1,
      projectRoot: '/project',
      mode: 'public',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' },
      origins: [{ origin: 'https://example.com' }],
      current: [fp('a')],
    });
    expect(input.key).toEqual({ source: 'env', name: 'ASTRO_AEO_INDEXNOW_KEY' });

    expect(parseIndexNowQueue({
      version: 1,
      origins: [{
        origin: 'https://example.com',
        mode: 'private',
        strict: false,
        targetDigest: sha256('target'),
        key: { source: 'file', path: 'secret.txt' },
        operations: [{ url: 'https://example.com/a', operation: 'upsert', fingerprint: sha256('a') }],
      }],
    }).origins[0].key).toEqual({ source: 'file', path: 'secret.txt' });
    expect(() => parseIndexNowQueue({
      version: 1,
      origins: [{
        origin: 'http://example.com', mode: 'private', strict: false,
        targetDigest: sha256('x'), key: { source: 'env' }, operations: [],
      }],
    })).toThrow(/HTTPS/u);
    expect(() => validateRootPath('/keys/%2e%2e/secret.txt')).toThrow(/safe root-relative/u);
    expect(() => validateRootPath('/keys/key.txt?secret=1')).toThrow(/query/u);
    expect(() => parseIndexNowPrepareInput({
      version: 1,
      projectRoot: '/project',
      mode: 'private',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env', value: 'literal-secret' },
      origins: [],
      current: [],
    })).toThrow(/unknown field/u);
    expect(() => parseIndexNowQueue({
      version: 1,
      origins: [{
        origin: 'https://example.com', mode: 'public', strict: false,
        targetDigest: sha256('x'), key: { source: 'env' }, operations: [],
      }],
    })).toThrow(/state URL/u);
  });
});
