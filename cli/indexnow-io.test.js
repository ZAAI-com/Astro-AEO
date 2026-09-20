import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { IndexNowInvocationError, readJsonFile, writePrivateFile } from './indexnow-io.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
    roots.push(root, outsideRoot);
    symlinkSync(outsideRoot, join(root, '.astro'));

    expect(() => writePrivateFile(
      join(root, '.astro', 'aeo-cache', 'indexnow', 'pending-v1.json'),
      '{}\n',
      root,
    )).toThrow(IndexNowInvocationError);
    expect(() => readJsonFile(join(outsideRoot, 'aeo-cache', 'indexnow', 'pending-v1.json')))
      .toThrow();
  });

  test('still writes ordinary private state under the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-io-'));
    roots.push(root);
    const path = join(root, '.astro', 'aeo-cache', 'indexnow', 'pending-v1.json');
    writePrivateFile(path, '{}\n', root);
    expect(readJsonFile(path)).toEqual({});
  });
});
