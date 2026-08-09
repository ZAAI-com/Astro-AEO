import { test, expect, describe, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The compatibility guarantee for the 1.0 -> 1.1 config rename, asserted the only
// way that actually proves it: build the same site twice, once with every 1.0 key
// and once with every canonical key, and diff the two outputs byte for byte. Unit
// tests on `resolveConfig` can only show the two resolve alike; this shows they
// also *generate* alike, through every generator.
//
// This uses its own fixture root rather than the demo, because vitest runs test
// files in parallel and two `astro build` runs against one root clobber each
// other's output directory.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/config-compat');
const LEGACY_DIST = join(FIXTURE, 'dist-legacy');
const CANONICAL_DIST = join(FIXTURE, 'dist-canonical');

const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro,
);

/** Every file under `dir`, as paths relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

describe('1.0 and 1.1 configurations produce identical output', () => {
  beforeAll(() => {
    for (const config of ['astro.legacy.config.mjs', 'astro.canonical.config.mjs']) {
      execFileSync('node', [astroBin, 'build', '--root', FIXTURE, '--config', config], {
        cwd: REPO,
        stdio: 'ignore',
      });
    }
  });

  test('both builds emit exactly the same set of files', () => {
    expect(walk(CANONICAL_DIST).sort()).toEqual(walk(LEGACY_DIST).sort());
  });

  test('every emitted file is byte-identical', () => {
    const differing = walk(LEGACY_DIST).filter(
      (rel) =>
        Buffer.compare(
          readFileSync(join(LEGACY_DIST, rel)),
          readFileSync(join(CANONICAL_DIST, rel)),
        ) !== 0,
    );
    expect(differing).toEqual([]);
  });

  test('the artifacts under test are present, so an empty diff means something', () => {
    // Without this, deleting every generator would also make the diff empty.
    const files = walk(LEGACY_DIST);
    for (const expected of [
      'llms.txt',
      'llms-full.txt',
      'robots.txt',
      'sitemap.xml',
      'compat-index.xml',
      'index.md',
      join('blog', 'post.md'),
      join('.well-known', 'domain-profile.json'),
    ]) {
      expect(files, expected).toContain(expected);
    }
  });

  test('the fixture actually exercises the options it configures', () => {
    const llms = readFileSync(join(LEGACY_DIST, 'llms.txt'), 'utf8');
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
    expect(readFileSync(join(LEGACY_DIST, 'index.md'), 'utf8')).toMatch(/^---\n/);
    expect(readFileSync(join(LEGACY_DIST, 'robots.txt'), 'utf8')).toContain('/compat-index.xml');
    // domainProfile.contact is a two-hop alias: contact -> email -> site.profile.email.
    expect(readFileSync(join(LEGACY_DIST, '.well-known/domain-profile.json'), 'utf8')).toContain(
      'hello@compat.example.com',
    );
  });
});
