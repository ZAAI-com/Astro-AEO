#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const skipPerformance = args.includes('--skip-performance');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
const requireTag = args.includes('--require-tag');
const requireClean = args.includes('--require-clean');

if (requireClean) {
  const worktree = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (worktree.status !== 0) throw new Error('Could not inspect the Git worktree before release.');
  if (worktree.stdout.trim()) {
    throw new Error('release:check requires a clean Git checkout when --require-clean is set.');
  }
}

const metadataArgs = ['scripts/check-release-metadata.mjs'];
if (tag) metadataArgs.push('--tag', tag);
if (requireTag) metadataArgs.push('--require-tag');

const steps = [
  ['Configuration schema freshness', 'node', ['scripts/check-schema.mjs']],
  ['Migration documentation freshness', 'node', ['scripts/check-migration-docs.mjs']],
  ...(!requireTag
    ? [['Changeset coverage', 'node', ['scripts/check-changesets.mjs', '--since', 'origin/main']]]
    : []),
  ['Release metadata', 'node', metadataArgs],
  ['Current TypeScript declarations', 'pnpm', ['run', 'typecheck']],
  ['Oldest supported TypeScript consumer', 'pnpm', ['run', 'test:types']],
  ['Unit, CLI, and static build tests', 'pnpm', ['test']],
];

if (!quick) {
  for (const script of [
    'test:dev',
    'test:ssr',
    'test:trailing',
    'test:adapters:build',
    'test:adapters:runtime',
  ]) {
    if (!pkg.scripts?.[script]) {
      throw new Error(`package.json must define ${JSON.stringify(script)} before release:check can pass`);
    }
  }
  steps.push(
    ['Development-server contract', 'pnpm', ['run', 'test:dev']],
    ['Node adapter contract', 'pnpm', ['run', 'test:ssr']],
    ['Base-path trailing-slash matrix', 'pnpm', ['run', 'test:trailing']],
    ['Adapter build matrix', 'pnpm', ['run', 'test:adapters:build']],
    ['Adapter local-runtime matrix', 'pnpm', ['run', 'test:adapters:runtime']],
    ['Adapter bundle baselines', 'node', ['scripts/build-benchmark-baselines.mjs']],
    ['Packed tarball install and Astro build', 'node', ['scripts/package-smoke.mjs']],
  );
  if (!skipPerformance) {
    steps.push([
      'Performance safety ceilings',
      'node',
      ['scripts/run-release-benchmark.mjs'],
    ]);
  }
} else {
  steps.push(['Packed tarball contents', 'node', ['scripts/package-smoke.mjs', '--inspect-only']]);
}

const started = Date.now();
for (const [name, command, commandArgs] of steps) {
  console.log(`\n==> ${name}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nRelease check stopped at: ${name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nRelease check passed in ${Math.round((Date.now() - started) / 1000)} seconds.`);
