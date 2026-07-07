import { test, expect, describe } from 'vitest';
import { absoluteUrl, mdHrefFor } from './collect.js';

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
