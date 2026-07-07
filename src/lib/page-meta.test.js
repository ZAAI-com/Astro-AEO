import { test, expect, describe } from 'vitest';
import {
  makeTitleStripper,
  extractTitle,
  extractDescription,
  extractAeoTokens,
  extractNoindex,
  extractModifiedTime,
  isRedirectStub,
} from './page-meta.js';

describe('makeTitleStripper', () => {
  test('false is a no-op', () => {
    expect(makeTitleStripper(false)('A | B')).toBe('A | B');
  });

  test('string suffix strips pipe/dash separators', () => {
    const strip = makeTitleStripper('ZAAI.com');
    expect(strip('About | ZAAI.com')).toBe('About');
    expect(strip('About - ZAAI.com')).toBe('About');
  });

  test('array of suffixes', () => {
    const strip = makeTitleStripper(['ZAAI.com', 'ZAAI Product Engineering Lab']);
    expect(strip('Privacy | ZAAI Product Engineering Lab')).toBe('Privacy');
    expect(strip('Privacy | Do Git Work')).toBe('Privacy | Do Git Work');
  });

  test('RegExp suffix', () => {
    const strip = makeTitleStripper(/\s*\|\s*ZAAI\.com$/);
    expect(strip('Home | ZAAI.com')).toBe('Home');
  });
});

describe('extractTitle / extractDescription', () => {
  const html =
    '<html><head><title>Hello &amp; Bye | Demo Site</title>' +
    '<meta name="description" content="A &lt;great&gt; page"></head><body></body></html>';

  test('decodes entities and strips suffix', () => {
    expect(extractTitle(html, makeTitleStripper('Demo Site'))).toBe('Hello & Bye');
  });

  test('description decodes entities', () => {
    expect(extractDescription(html)).toBe('A <great> page');
  });

  test('description with content before name', () => {
    const h = '<meta content="Reversed order" name="description">';
    expect(extractDescription(h)).toBe('Reversed order');
  });
});

describe('aeo tokens / noindex / modified time / redirect', () => {
  test('aeo tokens split on whitespace and commas', () => {
    const tokens = extractAeoTokens('<meta name="aeo" content="no-dotmd, no-llms">');
    expect(tokens.has('no-dotmd')).toBe(true);
    expect(tokens.has('no-llms')).toBe(true);
  });

  test('noindex detection', () => {
    expect(extractNoindex('<meta name="robots" content="noindex, follow">')).toBe(true);
    expect(extractNoindex('<meta name="robots" content="index, follow">')).toBe(false);
  });

  test('article:modified_time parses', () => {
    const d = extractModifiedTime('<meta property="article:modified_time" content="2026-02-15T00:00:00Z">');
    expect(d?.toISOString().slice(0, 10)).toBe('2026-02-15');
  });

  test('redirect stub detection', () => {
    expect(isRedirectStub('<meta http-equiv="refresh" content="0;url=/new/">')).toBe(true);
    expect(isRedirectStub('<meta charset="utf-8">')).toBe(false);
  });
});
