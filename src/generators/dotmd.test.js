import { test, expect, describe } from 'vitest';
import { hasMarkdownAlternateLink } from './dotmd.js';

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
