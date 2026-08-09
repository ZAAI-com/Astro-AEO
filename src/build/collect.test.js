import { afterEach, test, expect, describe } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absoluteUrl, collectPages, mdHrefFor, resolveHtmlPath, stripLeadingFrontmatter } from './collect.js';
import { resolveConfig } from '../config.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('absoluteUrl', () => {
  test('applies base and trailing slash', () => {
    expect(absoluteUrl('https://x.com', '', '/about', 'always')).toBe('https://x.com/about/');
    expect(absoluteUrl('https://x.com', '', '/about', 'never')).toBe('https://x.com/about');
    expect(absoluteUrl('https://x.com', '/docs', '/about', 'always')).toBe('https://x.com/docs/about/');
    // a trailing slash on base is normalized away
    expect(absoluteUrl('https://x.com', '/docs/', '/about', 'ignore')).toBe('https://x.com/docs/about/');
  });

  test('root path keeps a single slash', () => {
    expect(absoluteUrl('https://x.com', '/docs', '/', 'always')).toBe('https://x.com/docs/');
    expect(absoluteUrl('https://x.com', '', '/', 'never')).toBe('https://x.com/');
  });
});

describe('mdHrefFor', () => {
  test('base-prefixed root-relative md href', () => {
    expect(mdHrefFor('/', '')).toBe('/index.md');
    expect(mdHrefFor('/about', '')).toBe('/about.md');
    expect(mdHrefFor('/about', '/docs')).toBe('/docs/about.md');
    expect(mdHrefFor('/blog/post', '/docs/')).toBe('/docs/blog/post.md');
  });
});

describe('leading-slash pathnames stay inside distRoot', () => {
  // Regression guard for two review claims that path.join(distRoot, "/x")
  // escapes distRoot on POSIX. It does not: only path.resolve resets on an
  // absolute segment; path.join collapses the leading "/" to a separator.
  const distRoot = join('/tmp', 'aeo-dist');

  test('resolveHtmlPath resolves under distRoot for both build formats', () => {
    expect(resolveHtmlPath(distRoot, '/', 'directory')).toBe(join(distRoot, 'index.html'));
    expect(resolveHtmlPath(distRoot, '/about', 'directory')).toBe(join(distRoot, 'about', 'index.html'));
    expect(resolveHtmlPath(distRoot, '/about', 'file')).toBe(join(distRoot, 'about.html'));
    expect(resolveHtmlPath(distRoot, '/blog/post', 'directory')).toBe(join(distRoot, 'blog', 'post', 'index.html'));
    expect(resolveHtmlPath(distRoot, '/about', 'directory').startsWith(distRoot)).toBe(true);
  });

  test('normalizes Astro page names and keeps status pages flat', () => {
    expect(resolveHtmlPath(distRoot, 'about/', 'file')).toBe(join(distRoot, 'about.html'));
    expect(resolveHtmlPath(distRoot, '/about/', 'directory')).toBe(
      join(distRoot, 'about', 'index.html'),
    );
    expect(resolveHtmlPath(distRoot, '404/', 'directory')).toBe(join(distRoot, '404.html'));
    expect(resolveHtmlPath(distRoot, '/500/', 'directory')).toBe(join(distRoot, '500.html'));
  });

  test('the .md companion join keeps the file under distRoot', () => {
    // Mirrors collect.js: join(distRoot, `${pathname}.md`) with pathname "/about".
    const mdPath = join(distRoot, '/about.md');
    expect(mdPath).toBe(join(distRoot, 'about.md'));
    expect(mdPath.startsWith(distRoot)).toBe(true);
    expect(isAbsolute(mdPath)).toBe(true);
  });
});

describe('collectPages serializable dates', () => {
  test('preserves catalog dates and serializes the git/filesystem fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-collect-'));
    roots.push(root);
    const distRoot = join(root, 'dist');
    const sourceRoot = join(root, 'src');
    mkdirSync(join(distRoot, 'catalog'), { recursive: true });
    mkdirSync(join(distRoot, 'git'), { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    const html = '<!doctype html><html><head><title>T</title></head><body><main>Body.</main></body></html>';
    writeFileSync(join(distRoot, 'catalog', 'index.html'), html);
    writeFileSync(join(distRoot, 'git', 'index.html'), html);
    const sourcePath = join(sourceRoot, 'git.astro');
    writeFileSync(sourcePath, '---\n---\n<p>Body.</p>\n');
    const fallbackDate = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(sourcePath, fallbackDate, fallbackDate);

    const pages = await collectPages(
      [
        { pathname: '/catalog', lastModified: '2026-02-15T12:30:00Z' },
        { pathname: '/git' },
      ],
      resolveConfig(),
      {
        distDir: pathToFileURL(`${distRoot}/`),
        siteUrl: 'https://x.com',
        base: '',
        trailingSlash: 'always',
        buildFormat: 'directory',
        projectRoot: root,
        routeEntrypoints: new Map([['/git', 'src/git.astro']]),
        logger: { warn() {} },
      },
    );

    expect(pages.find((page) => page.pathname === '/catalog')?.lastModified).toBe(
      '2026-02-15T12:30:00.000Z',
    );
    expect(pages.find((page) => page.pathname === '/git')?.lastModified).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(() => JSON.stringify(pages)).not.toThrow();
  });
});

describe('authored source resolution', () => {
  test('an explicitly empty catalog source is preserved without built HTML', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-empty-catalog-source-'));
    roots.push(root);
    const distRoot = join(root, 'dist');
    const warnings = [];

    const pages = await collectPages(
      [{ pathname: '/empty', title: 'Empty', markdown: '' }],
      resolveConfig(),
      {
        distDir: pathToFileURL(`${distRoot}/`),
        siteUrl: 'https://x.com',
        base: '',
        trailingSlash: 'always',
        buildFormat: 'directory',
        projectRoot: root,
        routeEntrypoints: new Map(),
        logger: { warn: (message) => warnings.push(message) },
      },
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      pathname: '/empty',
      title: 'Empty',
      markdown: '',
      source: { strategy: 'catalog' },
    });
    expect(warnings).toEqual([]);
  });

  test('standalone Markdown is preserved and leading frontmatter is removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-markdown-source-'));
    roots.push(root);
    const distRoot = join(root, 'dist');
    mkdirSync(join(distRoot, 'guide'), { recursive: true });
    mkdirSync(join(root, 'src', 'pages'), { recursive: true });
    writeFileSync(
      join(distRoot, 'guide', 'index.html'),
      '<html><head><title>Guide</title></head><body><main><h1>Rendered approximation</h1></main></body></html>',
    );
    writeFileSync(
      join(root, 'src', 'pages', 'guide.md'),
      '---\ntitle: Guide\n---\n# Exact Guide\n\n- authored\n',
    );

    const pages = await collectPages(
      [{ pathname: '/guide' }],
      resolveConfig(),
      {
        distDir: pathToFileURL(`${distRoot}/`),
        siteUrl: 'https://x.com',
        base: '',
        trailingSlash: 'always',
        buildFormat: 'directory',
        projectRoot: root,
        routeEntrypoints: new Map([['/guide', 'src/pages/guide.md']]),
        logger: { warn() {} },
      },
    );

    expect(pages[0].markdown).toBe('# Exact Guide\n\n- authored\n');
    expect(pages[0].source).toEqual({ strategy: 'markdown-route', path: 'src/pages/guide.md' });
    expect(pages[0].extraction).toBeUndefined();
  });

  test('catalog metadata enriches a standalone route without replacing its source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-catalog-markdown-route-'));
    roots.push(root);
    const distRoot = join(root, 'dist');
    mkdirSync(join(distRoot, 'guide'), { recursive: true });
    mkdirSync(join(root, 'src', 'pages'), { recursive: true });
    writeFileSync(
      join(distRoot, 'guide', 'index.html'),
      '<html><head><title>Rendered</title></head><body><main>Rendered approximation</main></body></html>',
    );
    writeFileSync(
      join(root, 'src', 'pages', 'guide.md'),
      '---\ntitle: Source title\n---\n# Exact source\n\nPreserved.\n',
    );

    const [page] = await collectPages(
      [{ pathname: '/guide', title: 'Catalog title', sourcePath: 'catalog:guide' }],
      resolveConfig(),
      {
        distDir: pathToFileURL(`${distRoot}/`),
        siteUrl: 'https://x.com',
        base: '',
        trailingSlash: 'always',
        buildFormat: 'directory',
        projectRoot: root,
        routeEntrypoints: new Map([['/guide', 'src/pages/guide.md']]),
        logger: { warn() {} },
      },
    );

    expect(page.title).toBe('Catalog title');
    expect(page.markdown).toBe('# Exact source\n\nPreserved.\n');
    expect(page.source).toEqual({ strategy: 'markdown-route', path: 'catalog:guide' });
    expect(page.extraction).toBeUndefined();
  });

  test('catalog source and metadata enrich a rendered route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-catalog-source-'));
    roots.push(root);
    const distRoot = join(root, 'dist');
    mkdirSync(join(distRoot, 'dynamic'), { recursive: true });
    writeFileSync(
      join(distRoot, 'dynamic', 'index.html'),
      '<html><head><title>Rendered</title></head><body><main>Approximation</main></body></html>',
    );
    const [page] = await collectPages(
      [{
        pathname: '/dynamic',
        title: 'Catalog title',
        markdown: '# Catalog source',
        sourcePath: 'cms:42',
        lastModified: '2026-08-05',
      }],
      resolveConfig(),
      {
        distDir: pathToFileURL(`${distRoot}/`),
        siteUrl: 'https://x.com',
        base: '',
        trailingSlash: 'always',
        buildFormat: 'directory',
        projectRoot: root,
        routeEntrypoints: new Map(),
        logger: { warn() {} },
      },
    );
    expect(page).toMatchObject({
      title: 'Catalog title',
      markdown: '# Catalog source',
      lastModified: '2026-08-05T00:00:00.000Z',
      source: { strategy: 'catalog', path: 'cms:42' },
    });
  });

  test('frontmatter stripping does not remove an ordinary horizontal rule', () => {
    expect(stripLeadingFrontmatter('---\nnot frontmatter without a close')).toBe(
      '---\nnot frontmatter without a close',
    );
  });
});
