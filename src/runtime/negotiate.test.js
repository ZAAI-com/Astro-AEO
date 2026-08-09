import { test, expect, describe } from 'vitest';
import { parseAccept, prefersMarkdown } from './negotiate.js';

describe('parseAccept', () => {
  test('reads types and q-values', () => {
    expect(parseAccept('text/html, text/markdown;q=0.8')).toEqual([
      { type: 'text/html', parameters: [], q: 1 },
      { type: 'text/markdown', parameters: [], q: 0.8 },
    ]);
  });

  test('lowercases types and tolerates whitespace', () => {
    expect(parseAccept('  TEXT/Markdown ; q=0.5 ')).toEqual([
      { type: 'text/markdown', parameters: [], q: 0.5 },
    ]);
  });

  test('invalidates a header containing an entry that is not a media type', () => {
    expect(parseAccept('garbage, text/html')).toBeNull();
  });

  test('retains and unquotes media parameters before the weight', () => {
    expect(parseAccept('text/markdown;level=1;note="a; b, c"')).toEqual([
      {
        type: 'text/markdown',
        parameters: [
          { name: 'level', value: '1' },
          { name: 'note', value: 'a; b, c' },
        ],
        q: 1,
      },
    ]);
    expect(parseAccept('text/markdown;note="escaped \\" quote";q=0.7;ext=yes')).toEqual([
      {
        type: 'text/markdown',
        parameters: [{ name: 'note', value: 'escaped " quote' }],
        q: 0.7,
      },
    ]);
  });

  test('invalidates malformed parameters instead of ignoring them', () => {
    for (const value of [
      'text/markdown;garbage',
      'text/markdown;;',
      'text/markdown;foo="unterminated',
      'text/markdown;q=1;garbage',
      'text/markdown;foo=',
      'text/markdown;foo="\x7f"',
      'text/markdown;foo="\\\x7f"',
    ]) {
      expect(parseAccept(value), value).toBeNull();
      expect(prefersMarkdown(value), value).toBe(false);
    }
  });

  test('drops entries with an out-of-range or unparseable q rather than clamping', () => {
    // Clamping would invent a preference the client never expressed.
    expect(parseAccept('text/markdown;q=5')).toBeNull();
    expect(parseAccept('text/markdown;q=-1')).toBeNull();
    expect(parseAccept('text/markdown;q=abc')).toBeNull();
    for (const value of ['1garbage', '0.9.1', '1=oops', '+1', '.9', '1.001']) {
      expect(parseAccept(`text/markdown;q=${value}`), value).toBeNull();
    }
  });

  test('rejects invalid wildcards and duplicate media parameters', () => {
    expect(parseAccept('*/markdown')).toBeNull();
    expect(parseAccept('text/**')).toBeNull();
    expect(parseAccept('te*xt/markdown')).toBeNull();
    expect(parseAccept('text/markdown;charset=utf-8;CHARSET=utf-8')).toBeNull();
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
    expect(prefersMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
    expect(prefersMarkdown('text/markdown;q=0.9, text/html;q=0.8')).toBe(true);
  });

  test('a tie resolves to HTML, which is what a browser can display', () => {
    expect(prefersMarkdown('text/markdown, text/html')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.5, text/html;q=0.5')).toBe(false);
  });

  test('html winning resolves to HTML', () => {
    expect(prefersMarkdown('text/html, text/markdown;q=0.8')).toBe(false);
    expect(
      prefersMarkdown('text/html;charset=UTF-8, text/markdown;q=0.8'),
    ).toBe(false);
  });

  test('a wildcard is not a request for markdown', () => {
    // Every curl and most crawlers send */*. Treating it as consent would serve
    // Markdown to almost everything.
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown('text/*')).toBe(false);
    expect(prefersMarkdown('*/*;q=1.0')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.5, text/*;q=0.9')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.9, text/*;q=0.5')).toBe(true);
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
    expect(prefersMarkdown('text/markdown, text/html;q=garbage')).toBe(false);
  });

  test('markdown at q=0 is a refusal, not a request', () => {
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
  });

  test('matches required parameters against the emitted UTF-8 representation', () => {
    expect(prefersMarkdown('text/markdown;charset=UTF-8, text/html;q=0.5')).toBe(true);
    expect(prefersMarkdown('text/markdown;charset=iso-8859-1, text/html;q=0.5')).toBe(false);
    expect(prefersMarkdown('text/markdown;level=1, text/html;q=0.5')).toBe(false);
    expect(
      prefersMarkdown(
        'text/markdown;charset=iso-8859-1;q=1, text/markdown;q=0.8, text/html;q=0.5',
      ),
    ).toBe(true);
  });

  test('does not alias legacy text/x-markdown to the emitted media type', () => {
    expect(prefersMarkdown('text/x-markdown')).toBe(false);
    expect(
      prefersMarkdown('text/x-markdown;q=1, text/markdown;q=0, text/html;q=0.5'),
    ).toBe(false);
  });

  test('application/xhtml+xml counts as html for ranking', () => {
    expect(prefersMarkdown('text/markdown;q=0.5, application/xhtml+xml;q=0.9')).toBe(false);
  });
});
