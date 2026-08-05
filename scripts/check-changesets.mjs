#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sinceIndex = process.argv.indexOf('--since');
const since = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : 'origin/main';
if (!since) throw new Error('--since requires a Git reference.');

const status = spawnSync('pnpm', ['exec', 'changeset', 'status', `--since=${since}`], {
  cwd: root,
  encoding: 'utf8',
});
if (status.status === 0) {
  console.log(`Changeset coverage is valid since ${since}.`);
  process.exit(0);
}

const pending = (await readdir(resolve(root, '.changeset')))
  .filter((name) => name.endsWith('.md') && name !== 'README.md');
if (pending.length > 0) {
  process.stderr.write(status.stdout);
  process.stderr.write(status.stderr);
  throw new Error('Changeset validation failed with pending changeset files.');
}

const currentPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const currentChangelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const basePackage = JSON.parse(gitShow(`${since}:package.json`));
const baseChangelog = gitShow(`${since}:CHANGELOG.md`);
const version = String(currentPackage.version);
const releaseHeading = new RegExp(`^## ${escapeRegex(version)}\\s*$`, 'm');

if (
  compareVersions(version, String(basePackage.version)) > 0 &&
  releaseHeading.test(currentChangelog) &&
  !releaseHeading.test(baseChangelog)
) {
  console.log(
    `Changesets were already consumed into version ${version} and its changelog since ${since}.`,
  );
  process.exit(0);
}

process.stderr.write(status.stdout);
process.stderr.write(status.stderr);
throw new Error(
  `Published-package changes since ${since} require a pending changeset or an already-versioned release.`,
);

function gitShow(specifier) {
  const result = spawnSync('git', ['show', specifier], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Could not read ${specifier}. Fetch the base branch before checking changesets.`);
  }
  return result.stdout;
}

function compareVersions(left, right) {
  const parse = (value) => value.split('-')[0].split('.').map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
