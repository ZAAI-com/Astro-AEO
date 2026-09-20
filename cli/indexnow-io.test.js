import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { IndexNowInvocationError, readJsonFile, writePrivateFile } from './indexnow-io.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A project root whose `.astro` entry is a symlink to a directory outside it.
 * Every confinement test needs the same pair, and both roots must be registered
 * for cleanup, so it is created in one place.
 */
function redirectedRoot() {
  const root = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
  roots.push(root, outsideRoot);
  symlinkSync(outsideRoot, join(root, '.astro'));
  return { root, outsideRoot };
}

describe('indexnow private state IO', () => {
  test('rejects a symlinked state file on read', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
    roots.push(root);
    const outside = join(root, 'outside.json');
    writeFileSync(outside, '{}');
    const linked = join(root, 'state.json');
    symlinkSync(outside, linked);

    expect(() => readJsonFile(linked)).toThrow(IndexNowInvocationError);
  });

  test('rejects private writes redirected through a symlinked ancestor', () => {
    const { root, outsideRoot } = redirectedRoot();

    expect(() => writePrivateFile(
      join(root, '.astro', 'aeo-cache', 'indexnow', 'pending-v1.json'),
      '{}\n',
      root,
    )).toThrow(IndexNowInvocationError);
    expect(() => readJsonFile(join(outsideRoot, 'aeo-cache', 'indexnow', 'pending-v1.json')))
      .toThrow();
  });

  test('creates no directory outside the project through a symlinked ancestor', () => {
    const { root, outsideRoot } = redirectedRoot();

    expect(() => writePrivateFile(
      join(root, '.astro', 'aeo-cache', 'indexnow', 'pending-v1.json'),
      '{}\n',
      root,
    )).toThrow(IndexNowInvocationError);
    // The confinement check must run before mkdir, not after: a rejected write
    // that still materialized the tree outside the project is a filesystem
    // change the caller never authorized.
    expect(existsSync(join(outsideRoot, 'aeo-cache'))).toBe(false);
  });

  test('refuses to read private state through a symlinked ancestor', () => {
    const { root, outsideRoot } = redirectedRoot();
    writeFileSync(join(outsideRoot, 'pending-v1.json'), '{"version":1}');

    // The final entry is an ordinary file, so the lstat check alone accepts it.
    // Only canonical confinement of the directory chain rejects the redirect.
    const path = join(root, '.astro', 'pending-v1.json');
    expect(readJsonFile(path)).toEqual({ version: 1 });
    expect(() => readJsonFile(path, root)).toThrow(IndexNowInvocationError);
  });

  test('still writes ordinary private state under the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
    roots.push(root);
    const path = join(root, '.astro', 'aeo-cache', 'indexnow', 'pending-v1.json');
    writePrivateFile(path, '{}\n', root);
    expect(readJsonFile(path)).toEqual({});
  });
});
