import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/representations-1.2');
const DIST = join(FIXTURE, 'dist');
const DIAGNOSTICS = join(FIXTURE, '.astro/aeo-cache/diagnostics-v1.json');
const astroPackage = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro,
);

const read = (pathname) => readFileSync(join(DIST, pathname), 'utf8');

describe('the real 1.2 representation fixture', () => {
  beforeAll(() => {
    execFileSync('node', [astroBin, 'build', '--root', FIXTURE], {
      cwd: REPO,
      stdio: 'ignore',
    });
  });

  test('preserves authored content-collection and standalone Markdown', () => {
    const collection = read('posts/collection-post.md');
    expect(collection).toContain('# Collection source');
    expect(collection).toContain('This sentence exists only in the authored collection body.');
    expect(collection).toContain('(../../assets/collection.pdf)');
    expect(collection).not.toMatch(/Navigation must not|Footer must not/);

    const standalone = read('markdown.md');
    expect(standalone).toContain('# Standalone Markdown');
    expect(standalone).toContain('(../assets/standalone.pdf)');
    expect(standalone).not.toContain('The raw route source should win.');
  });

  test('uses registered MDX and CMS renderers before rendered HTML', () => {
    const mdx = read('mdx.md');
    expect(mdx).toContain('# MDX source');
    expect(mdx).toContain('<aside>');
    expect(mdx).toContain('**Mapped without evaluation.**');
    expect(mdx).not.toMatch(/import Unused|Rendered MDX fallback/);

    const cms = read('cms.md');
    expect(cms).toBe('# CMS source\n\nExact body from the CMS adapter.\n');
    expect(cms).not.toContain('Rendered CMS fallback');
  });

  test('falls back safely after a custom renderer exception', () => {
    const markdown = read('renderer-failure.md');
    expect(markdown).toContain('# Safe rendered fallback');
    expect(markdown).toContain('Project HTML remains usable after the extension fails.');

    const rawDiagnostics = readFileSync(DIAGNOSTICS, 'utf8');
    const manifest = JSON.parse(rawDiagnostics);
    expect(manifest.pages.find((page) => page.pathname === '/renderer-failure')?.diagnostics)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'markdown-renderer-threw', severity: 'warning' }),
      ]));
    expect(rawDiagnostics).not.toContain('SECRET RENDERER PAYLOAD');
  });

  test('preserves tables, captions, media, code languages, callouts, and resolved assets', () => {
    const markdown = read('rich.md');
    expect(markdown).toContain('<caption>Quarterly totals</caption>');
    expect(markdown).toContain('<figcaption>Accessible media caption</figcaption>');
    expect(markdown).toContain('src="https://representations.example.com/media/chart.png"');
    expect(markdown).toContain('src="https://representations.example.com/media/demo.mp4"');
    expect(markdown).toContain('poster="https://representations.example.com/media/poster.jpg"');
    expect(markdown).toContain('```typescript');
    expect(markdown).toContain('<aside class="callout">');
    expect(markdown).toContain('href="https://representations.example.com/docs/evidence.pdf"');
  });

  test('handles malformed, empty, and suspiciously short rendered documents', () => {
    expect(read('malformed.md')).toContain('After comment');
    expect(read('malformed.md')).toContain('Second paragraph');
    expect(read('empty.md')).toBe('\n');
    expect(read('short.md')).toBe('x\n');

    const manifest = JSON.parse(readFileSync(DIAGNOSTICS, 'utf8'));
    const empty = manifest.pages.find((page) => page.pathname === '/empty');
    const short = manifest.pages.find((page) => page.pathname === '/short');
    expect(empty?.extraction).toMatchObject({ strategy: 'main', outputCharacters: 0 });
    expect(short?.extraction).toMatchObject({ strategy: 'main', outputCharacters: 1 });
    expect(existsSync(join(DIST, 'empty/index.html'))).toBe(true);
    expect(existsSync(join(DIST, 'short/index.html'))).toBe(true);
  });
});
