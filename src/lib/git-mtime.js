// @ts-check
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

/** @type {Map<string, Date | undefined>} */
const cache = new Map();

/**
 * Last-modified date of a source file, from git commit history when available,
 * falling back to the filesystem mtime. Returns undefined when neither works.
 *
 * Uses execFileSync (no shell) so paths cannot be interpreted as shell input.
 * @param {string} filePath
 * @param {{ cwd?: string }} [opts] cwd applies to both the git lookup and the
 *   filesystem-mtime fallback: a relative filePath resolves against it in both
 *   branches (an absolute filePath is unaffected).
 * @returns {Date | undefined}
 */
export function getGitLastModified(filePath, opts = {}) {
  const key = `${opts.cwd ?? ''}::${filePath}`;
  if (cache.has(key)) return cache.get(key);

  /** @type {Date | undefined} */
  let result;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: opts.cwd,
    }).trim();
    if (out) {
      const d = new Date(out);
      if (!Number.isNaN(d.getTime())) result = d;
    }
  } catch {
    // git missing, not a repo, or file untracked: fall through to mtime
  }

  if (!result) {
    try {
      // Resolve against cwd so the fallback agrees with the git lookup for a
      // relative filePath; resolve() leaves an absolute filePath unchanged.
      result = statSync(opts.cwd ? resolve(opts.cwd, filePath) : filePath).mtime;
    } catch {
      result = undefined;
    }
  }

  cache.set(key, result);
  return result;
}

/** Clear the in-process cache (used by tests). */
export function _clearGitCache() {
  cache.clear();
}
