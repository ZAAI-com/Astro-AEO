import { describe, expect, test } from 'vitest';
import {
  chunkPathname,
  formatChunkPart,
  resolveSectionSlugs,
  scanMarkdownBlocks,
  sectionSlugBase,
} from './corpus-blocks.js';

describe('scanMarkdownBlocks', () => {
  test('separates headings, paragraphs, and complete fences', () => {
    const blocks = scanMarkdownBlocks('# Heading\r\n\r\nOne\nline\n\n```js\n\nconst x = 1;\n```\n\nEnd.');
    expect(blocks.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'heading', text: '# Heading' },
      { kind: 'paragraph', text: 'One\nline' },
      { kind: 'fence', text: '```js\n\nconst x = 1;\n```' },
      { kind: 'paragraph', text: 'End.' },
    ]);
  });

  test('keeps an unclosed fence indivisible through end of input', () => {
    expect(scanMarkdownBlocks('~~~ts\nconst x = 1;\n\nStill code.')).toEqual([
      { kind: 'fence', text: '~~~ts\nconst x = 1;\n\nStill code.', startLine: 1, endLine: 4 },
    ]);
  });
});

describe('section slugs and chunk paths', () => {
  test('uses lowercase NFKD ASCII hyphenation and a stable empty fallback', () => {
    expect(sectionSlugBase('  Café & API v2  ')).toBe('cafe-api-v2');
    expect(sectionSlugBase('東京')).toBe('section');
  });

  test('suffixes every distinct normalization collision but reuses exact identities', async () => {
    const [accented, ascii, repeated] = await resolveSectionSlugs(['Café', 'Cafe', 'Café']);
    expect(accented).toMatch(/^cafe-[0-9a-f]{8,64}$/);
    expect(ascii).toMatch(/^cafe-[0-9a-f]{8,64}$/);
    expect(accented).not.toBe(ascii);
    expect(repeated).toBe(accented);
  });

  test('pads through 9999 and expands naturally', () => {
    expect(formatChunkPart(1)).toBe('0001');
    expect(formatChunkPart(10_000)).toBe('10000');
    expect(chunkPathname({ sectionSlug: 'guides', part: 2 })).toBe('/llms/guides-0002.txt');
    expect(chunkPathname({ locale: 'en', sectionSlug: 'guides', part: 2 })).toBe('/en/llms/guides-0002.txt');
    expect(() => formatChunkPart(0)).toThrow(/positive safe integer/);
  });
});
