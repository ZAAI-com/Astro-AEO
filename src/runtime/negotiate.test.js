import { test, expect, describe } from 'vitest';
import { ACCEPT_CONTRACT } from '../../test/contracts/accept.js';
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

// The cases live in one shared table so the static edge handlers and the deployment
// probe are held to exactly the header semantics the middleware implements.
describe('prefersMarkdown', () => {
  test('the contract table is not empty and covers both outcomes', () => {
    expect(ACCEPT_CONTRACT.length).toBeGreaterThan(20);
    expect(new Set(ACCEPT_CONTRACT.map((entry) => entry.markdown))).toEqual(new Set([true, false]));
  });

  test.each(ACCEPT_CONTRACT)('$name', ({ accept, markdown }) => {
    expect(prefersMarkdown(accept)).toBe(markdown);
  });
});
