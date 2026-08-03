import { test, expect, describe } from 'vitest';
import { parseAccept, prefersMarkdown } from './negotiate.js';

describe('parseAccept', () => {
  test('reads types and q-values', () => {
    expect(parseAccept('text/html, text/markdown;q=0.8')).toEqual([
      { type: 'text/html', q: 1 },
      { type: 'text/markdown', q: 0.8 },
    ]);
  });

  test('lowercases types and tolerates whitespace', () => {
    expect(parseAccept('  TEXT/Markdown ; q=0.5 ')).toEqual([{ type: 'text/markdown', q: 0.5 }]);
  });

  test('drops entries that are not media types', () => {
    expect(parseAccept('garbage, text/html')).toEqual([{ type: 'text/html', q: 1 }]);
  });

  test('drops entries with an out-of-range or unparseable q rather than clamping', () => {
    // Clamping would invent a preference the client never expressed.
    expect(parseAccept('text/markdown;q=5')).toEqual([]);
    expect(parseAccept('text/markdown;q=-1')).toEqual([]);
    expect(parseAccept('text/markdown;q=abc')).toEqual([]);
  });

  test('an empty or absent header parses to nothing', () => {
    expect(parseAccept('')).toEqual([]);
    expect(parseAccept(null)).toEqual([]);
    expect(parseAccept(undefined)).toEqual([]);
  });
});

describe('prefersMarkdown', () => {
  test('true only when markdown is asked for and strictly outranks html', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true);
    expect(prefersMarkdown('text/x-markdown')).toBe(true);
    expect(prefersMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
    expect(prefersMarkdown('text/markdown;q=0.9, text/html;q=0.8')).toBe(true);
  });

  test('a tie resolves to HTML, which is what a browser can display', () => {
    expect(prefersMarkdown('text/markdown, text/html')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.5, text/html;q=0.5')).toBe(false);
  });

  test('html winning resolves to HTML', () => {
    expect(prefersMarkdown('text/html, text/markdown;q=0.8')).toBe(false);
  });

  test('a wildcard is not a request for markdown', () => {
    // Every curl and most crawlers send */*. Treating it as consent would serve
    // Markdown to almost everything.
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown('text/*')).toBe(false);
    expect(prefersMarkdown('*/*;q=1.0')).toBe(false);
  });

  test('a browser Accept header resolves to HTML', () => {
    expect(
      prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8'),
    ).toBe(false);
  });

  test('a missing or malformed header resolves to HTML', () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown('')).toBe(false);
    expect(prefersMarkdown(';;;')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=notanumber')).toBe(false);
  });

  test('markdown at q=0 is a refusal, not a request', () => {
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
  });

  test('application/xhtml+xml counts as html for ranking', () => {
    expect(prefersMarkdown('text/markdown;q=0.5, application/xhtml+xml;q=0.9')).toBe(false);
  });
});
