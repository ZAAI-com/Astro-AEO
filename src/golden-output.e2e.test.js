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

// The bytes in expected.json were frozen against this Astro major.
const GOLDEN_ASTRO_MAJOR = 7;
const installedAstroMajor = Number.parseInt(astroPkg.version, 10);

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

  // Version-independent, so it runs on every supported Astro major: whatever
  // Astro does to the HTML, astro-aeo must still emit exactly this set of
  // artifacts. This is the real cross-major guarantee.
  test('emits the frozen file set', () => {
    expect(walk(ACTUAL).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  // Byte comparison only against the Astro major the bytes came from.
  //
  // The frozen `.html` files are Astro's own rendering, which changes between
  // majors, so on Astro 5 and 6 all five differ. `llms-full.txt` differs there
  // too, and that is the same cause rather than an exception: the fixture's
  // `no-md` page carries `no-dotmd`, so it has no `.md` companion and its
  // converted content reaches exactly one artifact. Our artifacts are derived
  // from Astro's HTML, so they inherit its version sensitivity.
  //
  // Running this on Astro 5 would therefore be asking whether Astro 5 renders
  // like Astro 7. It never will, and there is no astro-aeo regression it could
  // catch there that it does not already catch here.
  const byteCheck = installedAstroMajor === GOLDEN_ASTRO_MAJOR ? test : test.skip;
  byteCheck(`keeps every frozen artifact byte-identical (Astro ${GOLDEN_ASTRO_MAJOR})`, () => {
    const differing = Object.entries(GOLDEN).filter(
      ([path, encoded]) =>
        Buffer.compare(Buffer.from(encoded, 'base64'), readFileSync(join(ACTUAL, path))) !== 0,
    ).map(([path]) => path);
    expect(differing).toEqual([]);
  });
});
