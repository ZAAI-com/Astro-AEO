#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const astro = resolve(root, 'node_modules/.bin/astro');

for (const fixture of ['node-baseline', 'cloudflare-baseline']) {
  console.log(`Building ${fixture}`);
  const result = spawnSync(astro, ['build', '--root', resolve(root, 'fixtures/benchmarks', fixture)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
