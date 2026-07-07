import { test, expect, describe } from 'vitest';
import { hasMarkdownAlternateLink, matchMarkdownAlternateLinks } from './dotmd.js';

describe('hasMarkdownAlternateLink', () => {
  test('detects rel-before-type ordering', () => {
    expect(hasMarkdownAlternateLink('<link rel="alternate" type="text/markdown" href="/x.md">')).toBe(true);
  });

  test('detects type-before-rel ordering', () => {
    expect(hasMarkdownAlternateLink('<link type="text/markdown" rel="alternate" href="/x.md">')).toBe(true);
  });

  test('false when there is no markdown alternate link', () => {
    expect(hasMarkdownAlternateLink('<link rel="stylesheet" href="/x.css">')).toBe(false);
    expect(hasMarkdownAlternateLink('<link rel="alternate" type="application/rss+xml" href="/feed.xml">')).toBe(false);
  });
});

describe('matchMarkdownAlternateLinks', () => {
  test('counts each markdown alternate link, either attribute order', () => {
    const html =
      '<link rel="alternate" type="text/markdown" href="/a.md">' +
      '<link type="text/markdown" rel="alternate" href="/b.md">';
    expect(matchMarkdownAlternateLinks(html)).toHaveLength(2);
  });

  test('ignores a type="text/markdown" link without rel="alternate"', () => {
    // Bare MIME-typed link must not count as an alternate (matches the injector).
    expect(matchMarkdownAlternateLinks('<link type="text/markdown" href="/x.md">')).toHaveLength(0);
  });

  test('returns an empty array when no links are present', () => {
    expect(matchMarkdownAlternateLinks('<p>no links here</p>')).toEqual([]);
  });
});
