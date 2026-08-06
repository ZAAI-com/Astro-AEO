import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/catalog-failures');
const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro,
);

describe('catalog import failures', () => {
  beforeAll(() => {
    execFileSync('node', [astroBin, 'build', '--root', FIXTURE], {
      cwd: REPO,
      stdio: 'ignore',
    });
  });

  test('do not fail the build or suppress healthy catalogs', () => {
    const corpus = readFileSync(join(FIXTURE, 'dist/llms-full.txt'), 'utf8');
    expect(corpus).toContain('# Healthy catalog');
    expect(corpus).toContain('Healthy catalog source.');
  });

  test('are retained as one diagnostic per failed module', () => {
    const manifest = JSON.parse(
      readFileSync(join(FIXTURE, '.astro/aeo-cache/diagnostics-v1.json'), 'utf8'),
    );
    const failures = manifest.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'catalog-load-failed',
    );
    expect(failures.map((failure) => failure.sourcePath).sort()).toEqual([
      './src/missing-catalog.js',
      './src/syntax-catalog.js',
      './src/throwing-catalog.js',
    ]);
  });
});
