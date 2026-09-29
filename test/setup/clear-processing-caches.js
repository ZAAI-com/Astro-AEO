// Vitest global setup. Fixture and recipe builds import the working tree's
// src/, but the processing cache keys on the package version, which does not
// change between source edits, so a warm cache could serve Markdown extracted
// by older code. Removing only processing-v1 keeps the ownership and IndexNow
// ledgers beside it intact.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** @param {string} parent @returns {string[]} */
function childDirectories(parent) {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => join(parent, entry.name));
}

export default function clearProcessingCaches() {
  const roots = [
    ...childDirectories(join(REPO, 'fixtures')),
    ...childDirectories(join(REPO, 'fixtures', 'adapters')),
    ...childDirectories(join(REPO, 'recipes')),
  ];
  for (const root of roots) {
    rmSync(join(root, '.astro', 'aeo-cache', 'processing-v1'), { recursive: true, force: true });
  }
}
