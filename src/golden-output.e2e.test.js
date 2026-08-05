import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/golden-1.0');
const ACTUAL = join(FIXTURE, 'dist');
const GOLDEN = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));
const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro,
);

function walk(directory, base = directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

describe('the current static pipeline preserves genuine 1.0 output', () => {
  beforeAll(() => {
    execFileSync('node', [astroBin, 'build', '--root', FIXTURE], {
      cwd: REPO,
      stdio: 'ignore',
    });
  });

  test('emits the frozen file set', () => {
    expect(walk(ACTUAL).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  test('keeps every frozen artifact byte-identical', () => {
    const differing = Object.entries(GOLDEN).filter(
      ([path, encoded]) =>
        Buffer.compare(Buffer.from(encoded, 'base64'), readFileSync(join(ACTUAL, path))) !== 0,
    ).map(([path]) => path);
    expect(differing).toEqual([]);
  });
});
