#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LEGACY_MOVES } from '../src/lib/config-migrate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
const start = readme.indexOf('### Migrating from 1.0');
const end = readme.indexOf('\n### ', start + 4);

if (start < 0) {
  console.error('README.md is missing the "Migrating from 1.0" section.');
  process.exit(1);
}

const migration = readme.slice(start, end < 0 ? undefined : end);
const codeSpans = [...migration.matchAll(/`([^`]+)`/g)]
  .flatMap((match) => match[1].split(/\s*,\s*|\s+\/\s+/))
  .map((value) => value.replace(/:\s*.*$/, '').trim());

function isCovered(path) {
  return codeSpans.some((value) => {
    if (value === path) return true;
    if (value.endsWith('.*')) return path.startsWith(value.slice(0, -1));
    return false;
  });
}

const missing = [];
for (const move of LEGACY_MOVES) {
  if (!isCovered(move.from)) missing.push(move.from);
  if (!isCovered(move.to)) missing.push(move.to);
}

if (missing.length > 0) {
  console.error('README.md migration table does not cover these configured moves:');
  for (const path of [...new Set(missing)].sort()) console.error(`  - ${path}`);
  process.exitCode = 1;
} else {
  console.log(`README migration table covers all ${LEGACY_MOVES.length} compatibility moves.`);
}
