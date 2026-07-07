import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getGitLastModified, _clearGitCache } from './git-mtime.js';

// These cases live outside any git repo (system temp), so the git lookup finds
// nothing and getGitLastModified falls through to the filesystem mtime, which is
// what the cwd-resolution behavior we care about here exercises.
describe('getGitLastModified filesystem fallback', () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    _clearGitCache();
    dir = mkdtempSync(join(tmpdir(), 'aeo-mtime-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves a relative filePath against opts.cwd', () => {
    writeFileSync(join(dir, 'file.txt'), 'hi');
    const expected = statSync(join(dir, 'file.txt')).mtime;
    const got = getGitLastModified('file.txt', { cwd: dir });
    expect(got).toBeInstanceOf(Date);
    expect(got?.getTime()).toBe(expected.getTime());
  });

  test('leaves an absolute filePath unaffected by opts.cwd', () => {
    const abs = join(dir, 'file.txt');
    writeFileSync(abs, 'hi');
    const expected = statSync(abs).mtime;
    // An unrelated cwd must not change where an absolute path resolves.
    const got = getGitLastModified(abs, { cwd: tmpdir() });
    expect(got?.getTime()).toBe(expected.getTime());
  });

  test('returns undefined for a relative path that cannot be resolved without cwd', () => {
    const got = getGitLastModified('aeo-definitely-missing-file.xyz');
    expect(got).toBeUndefined();
  });
});
