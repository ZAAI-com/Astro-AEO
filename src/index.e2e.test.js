import { test, expect, describe, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(REPO, 'fixtures', 'demo');
const DIST = join(DEMO, 'dist');
let buildOutput = '';

/** @param {string} p */
const read = (p) => readFileSync(join(DIST, p), 'utf8');

// Resolve Astro's CLI entry from its own bin field so this works across major
// versions (Astro 5 ships astro.js, Astro 7 ships bin/astro.mjs).
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);

beforeAll(() => {
  // Build under Node (the runtime real consumers use), not the Bun test runner.
  const result = spawnSync('node', [astroBin, 'build', '--root', DEMO], {
    cwd: REPO,
    encoding: 'utf8',
  });
  buildOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(buildOutput || `astro build exited ${result.status}`);
});

describe('demo build outputs', () => {
  test('.md companions exist for included pages only', () => {
    expect(existsSync(join(DIST, 'index.md'))).toBe(true);
    expect(existsSync(join(DIST, 'about.md'))).toBe(true);
    expect(existsSync(join(DIST, 'blog', 'first-post.md'))).toBe(true);
    // draft opts out via meta aeo skip; private/secret excluded via glob
    expect(existsSync(join(DIST, 'draft.md'))).toBe(false);
    expect(existsSync(join(DIST, 'private', 'secret.md'))).toBe(false);
  });

  test('llms.txt has the configured sections and lastmod markers', () => {
    const llms = read('llms.txt');
    expect(llms).toMatch(/^# Astro-AEO Demo/);
    expect(llms).toContain('## Home');
    expect(llms).toContain('## Blog');
    expect(llms).toContain('## Pages');
    expect(llms).toContain('[First Post](/blog/first-post.md)');
    // article:modified_time drives this date deterministically
    expect(llms).toContain('_(updated 2026-02-15)_');
    // excluded/skipped pages are absent
    expect(llms).not.toContain('/draft.md');
    expect(llms).not.toContain('/private/secret.md');
  });

  test('no-dotmd page has no .md companion and is omitted from llms.txt', () => {
    // no-md.astro carries meta aeo=no-dotmd; includeNoDotmd defaults to false.
    expect(existsSync(join(DIST, 'no-md.md'))).toBe(false);
    expect(read('llms.txt')).not.toContain('/no-md.md');
  });

  test('llms-full.txt inlines page bodies with separators', () => {
    const full = read('llms-full.txt');
    expect(full).toContain('# First Post');
    expect(full).toContain('Body of the first post');
    expect(full).toContain('\n---');
  });

  test('prerendered getStaticPaths routes require no catalog', () => {
    for (const pathname of [
      'dynamic/alpha',
      'dynamic/beta',
      'archive/2026/launch',
      'paged',
      'paged/2',
    ]) {
      expect(existsSync(join(DIST, `${pathname}.md`))).toBe(true);
      expect(existsSync(join(DIST, pathname, 'index.html'))).toBe(true);
    }
    expect(existsSync(join(DIST, 'empty'))).toBe(false);

    const llms = read('llms.txt');
    expect(llms).toContain('/dynamic/alpha.md');
    expect(llms).toContain('/archive/2026/launch.md');
    expect(llms).toContain('/paged/2.md');
    const full = read('llms-full.txt');
    expect(full).toContain('Body for the alpha dynamic route.');
    expect(full).toContain('Nested archive route body.');
    expect(full).toContain('Items: three.');

    const urlMap = readFileSync(join(DEMO, '.astro', 'test-url-map.md'), 'utf8');
    expect(urlMap).toContain('| /dynamic/alpha | /dynamic/alpha.md |');
    expect(urlMap).toContain('| /archive/2026/launch | /archive/2026/launch.md |');

    const diagnostics = JSON.parse(
      readFileSync(join(DEMO, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
    );
    expect(diagnostics.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed'))
      .toBe(false);
    expect(buildOutput).not.toContain('dynamic page routes');
  });

  test('every included page has exactly one markdown alternate link', () => {
    for (const p of ['index.html', 'about/index.html', 'blog/first-post/index.html']) {
      const matches = read(p).match(/type="text\/markdown"/g) || [];
      expect(matches.length).toBe(1);
    }
  });

  test('.md frontmatter carries stripped title, url and lastModified', () => {
    const md = read('about.md');
    expect(md).toContain('title: "About"'); // "| Demo Site" stripped
    expect(md).toContain('url: https://demo.example.com/about/');
    expect(md).toContain('lastModified:');
  });

  test('robots.txt and domain-profile.json are correct', () => {
    const robots = read('robots.txt');
    expect(robots).toContain('User-agent: Googlebot\nAllow: /');
    expect(robots).toContain('User-agent: GPTBot\nDisallow: /');
    const dp = JSON.parse(read('.well-known/domain-profile.json'));
    expect(dp.name).toBe('Astro-AEO Demo');
    expect(dp['@type']).toBe('Organization');
  });

  test('sitemap is auto-generated and referenced by robots.txt', () => {
    // sitemap.enabled defaults to true and the demo sets `site` without adding
    // @astrojs/sitemap itself, so astro-aeo auto-registers it.
    expect(existsSync(join(DIST, 'sitemap-index.xml'))).toBe(true);
    expect(existsSync(join(DIST, 'sitemap-0.xml'))).toBe(true);
    expect(read('robots.txt')).toContain('Sitemap: https://demo.example.com/sitemap-index.xml');
  });

  test('sitemapAlias mirrors the index to a conventional /sitemap.xml', () => {
    // sitemapAlias.enabled defaults to true; its integration runs after
    // @astrojs/sitemap, so /sitemap.xml is a byte-identical copy of the index.
    expect(existsSync(join(DIST, 'sitemap.xml'))).toBe(true);
    const alias = readFileSync(join(DIST, 'sitemap.xml'));
    const index = readFileSync(join(DIST, 'sitemap-index.xml'));
    expect(Buffer.compare(alias, index)).toBe(0);
  });

  test('component-driven JSON-LD is present', () => {
    const faq = read('faq/index.html');
    expect(faq).toContain('"@type":"FAQPage"');
    expect(faq).toContain('"@type":"BreadcrumbList"');
    expect(faq).toContain('"@type":"SpeakableSpecification"');
  });

  test('CLI validator passes on the build', () => {
    const out = execFileSync('node', [join(REPO, 'bin', 'astro-aeo.js'), 'validate', DIST], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(out).toContain('PASS');
  });
});
