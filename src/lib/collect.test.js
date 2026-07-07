import { test, expect, describe } from 'vitest';
import { join, isAbsolute } from 'node:path';
import { absoluteUrl, mdHrefFor, resolveHtmlPath } from './collect.js';

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

  test('the .md companion join keeps the file under distRoot', () => {
    // Mirrors collect.js: join(distRoot, `${pathname}.md`) with pathname "/about".
    const mdPath = join(distRoot, '/about.md');
    expect(mdPath).toBe(join(distRoot, 'about.md'));
    expect(mdPath.startsWith(distRoot)).toBe(true);
    expect(isAbsolute(mdPath)).toBe(true);
  });
});
