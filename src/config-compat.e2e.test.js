import { test, expect, describe, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_MOVES } from './lib/config-removed.js';

// The 2.0 compatibility guarantee, asserted by building the same site twice:
//
// - with every 1.0 key, which 2.0 removed: the build must stop and name each key;
// - with the canonical keys: the output must be byte-identical to what the
//   published 1.6.1 release built from the same configuration (expected-1.6.json).
//
// This uses its own fixture root rather than the demo, because vitest runs test
// files in parallel and two `astro build` runs against one root clobber each
// other's output directory.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/config-compat');
const CANONICAL_DIST = join(FIXTURE, 'dist-canonical');
const EXPECTED = JSON.parse(readFileSync(join(FIXTURE, 'expected-1.6.json'), 'utf8'));

const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro,
);

// expected-1.6.json holds Astro 7's rendering; other majors render HTML differently.
const EXPECTED_ASTRO_MAJOR = 7;
const installedAstroMajor = Number.parseInt(astroPkg.version, 10);

/** Every file under `dir`, as forward-slash paths relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full).split(sep).join('/')];
  });
}

describe('a 1.0 configuration is rejected', () => {
  /** @type {import('node:child_process').SpawnSyncReturns<string>} */
  let legacy;
  beforeAll(() => {
    legacy = spawnSync('node', [astroBin, 'build', '--root', FIXTURE, '--config', 'astro.legacy.config.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    });
  });

  test('the build exits non-zero', () => {
    expect(legacy.status).not.toBe(0);
  });

  test('the error names every removed key the config uses', () => {
    const output = `${legacy.stdout}\n${legacy.stderr}`;
    expect(output).toContain('these 1.0 configuration keys were removed in 2.0:');
    // Every 1.0 path astro.legacy.config.mjs sets, listed by hand so a lost key fails here.
    const used = [
      'stripTitleSuffix', 'exclude', 'respectNoindex',
      'llmsTxt.showLastmod', 'llmsTxt.includeNoDotmd', 'llmsTxt.sections', 'llmsTxt.defaultSection',
      'llmsFullTxt.mode', 'dotmd.frontmatter', 'dotmd.linkTag', 'urlMap.enabled',
      'sitemap.enabled', 'sitemap.options', 'sitemapAlias.enabled',
      'robotsTxt.enabled', 'robotsTxt.allow', 'robotsTxt.disallow', 'robotsTxt.extraLines',
      'domainProfile.enabled', 'domainProfile.name', 'domainProfile.description', 'domainProfile.contact',
      'domainProfile.sameAs', 'domainProfile.entityType',
    ].map((from) => {
      const move = LEGACY_MOVES.find((candidate) => candidate.from === from);
      expect(move, from).toBeDefined();
      return /** @type {import('./lib/config-removed.js').LegacyMove} */ (move);
    });
    for (const move of used) expect(output, move.from).toContain(`${move.from} -> ${move.to}`);
  });
});

describe('a canonical configuration builds what 1.6 built', () => {
  beforeAll(() => {
    execFileSync('node', [astroBin, 'build', '--root', FIXTURE, '--config', 'astro.canonical.config.mjs'], {
      cwd: REPO,
      stdio: 'ignore',
    });
  });

  test('emits exactly the 1.6 file set', () => {
    expect(walk(CANONICAL_DIST).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  const byteCheck = installedAstroMajor === EXPECTED_ASTRO_MAJOR ? test : test.skip;
  byteCheck(`every emitted file is byte-identical to 1.6 (Astro ${EXPECTED_ASTRO_MAJOR})`, () => {
    const differing = Object.entries(EXPECTED)
      .filter(([path, encoded]) => Buffer.compare(Buffer.from(encoded, 'base64'), readFileSync(join(CANONICAL_DIST, path))) !== 0)
      .map(([path]) => path);
    expect(differing).toEqual([]);
  });

  test('the fixture actually exercises the options it configures', () => {
    // Without this, a build that dropped every generator could still match a
    // snapshot that was regenerated carelessly.
    const llms = readFileSync(join(CANONICAL_DIST, 'llms.txt'), 'utf8');
    // stripTitleSuffix, sections, defaultSection, showLastModified, includeHtmlOnly.
    expect(llms).toContain('## Home');
    expect(llms).toContain('## Blog');
    expect(llms).toContain('## Pages');
    expect(llms).toContain('_(updated 2026-02-15)_');
    expect(llms).not.toContain('| Compat Site');
    // includeHtmlOnly keeps the no-dotmd page listed, pointing at HTML.
    expect(llms).toContain('No Companion');
    // exclude drops the private page entirely.
    expect(llms).not.toContain('Secret');

    // markdown.frontmatter, and the sitemap filenameBase tracked into robots.txt.
    expect(readFileSync(join(CANONICAL_DIST, 'index.md'), 'utf8')).toMatch(/^---\n/);
    expect(readFileSync(join(CANONICAL_DIST, 'robots.txt'), 'utf8')).toContain('/compat-index.xml');
    expect(readFileSync(join(CANONICAL_DIST, '.well-known/domain-profile.json'), 'utf8')).toContain(
      'hello@compat.example.com',
    );
  });
});
