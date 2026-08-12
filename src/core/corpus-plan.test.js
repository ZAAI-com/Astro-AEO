import { describe, expect, test } from 'vitest';
import { allocateSmallCorpus, planSectionChunks } from './corpus-plan.js';
import { renderChunkFragments, renderSectionedCorpus } from './render/corpus.js';

const siteMeta = { name: 'Site', description: 'Description.' };
const countCharacters = async (text) => text.length;
const page = (id, markdown, overrides = {}) => ({
  id,
  title: id.slice(1) || 'Home',
  canonicalUrl: `https://example.com${id}`,
  description: `Description for ${id}`,
  markdown,
  ...overrides,
});

describe('allocateSmallCorpus', () => {
  test('allocates one leading block per page before a second round', async () => {
    const pages = [page('/a', 'A1\n\nA2'), page('/b', 'B1\n\nB2')];
    const locales = [{ locale: 'en', language: 'en', sections: [{ title: 'Pages', pages }] }];
    const firstRound = renderSectionedCorpus({
      siteMeta,
      locales: [{
        language: 'en',
        sections: [{
          title: 'Pages',
          selections: pages.map((item) => ({ page: item, blocks: [item.markdown.split('\n\n')[0]] })),
        }],
      }],
      groupLanguages: true,
    });
    const result = await allocateSmallCorpus({
      siteMeta,
      locales,
      groupLanguages: true,
      maxTokens: firstRound.length,
      count: countCharacters,
    });
    expect(result.tokenCount).toBeLessThanOrEqual(firstRound.length);
    expect(result.pages).toEqual([
      { id: '/a', locale: 'en', section: 'Pages', includedBlocks: 1, totalBlocks: 2 },
      { id: '/b', locale: 'en', section: 'Pages', includedBlocks: 1, totalBlocks: 2 },
    ]);
    expect(result.text).toContain('A1');
    expect(result.text).toContain('B1');
    expect(result.text).not.toContain('A2');
    expect(result.text).not.toContain('B2');
  });

  test('retains a fitting wrapper when the first indivisible block cannot fit', async () => {
    const item = page('/large', 'x'.repeat(500));
    const locales = [{ locale: null, language: null, sections: [{ title: 'Pages', pages: [item] }] }];
    const wrapper = renderSectionedCorpus({
      siteMeta,
      locales: [{ language: null, sections: [{ title: 'Pages', selections: [{ page: item, blocks: [] }] }] }],
    });
    const result = await allocateSmallCorpus({
      siteMeta,
      locales,
      maxTokens: wrapper.length,
      count: countCharacters,
    });
    expect(result.text).toBe(wrapper);
    expect(result.pages[0].includedBlocks).toBe(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'small-corpus-first-block-omitted',
      pageId: '/large',
    }));
  });

  test('never publishes a preamble beyond the budget', async () => {
    const result = await allocateSmallCorpus({ siteMeta, locales: [], maxTokens: 1, count: countCharacters });
    expect(result).toMatchObject({ text: '', tokenCount: 0 });
    expect(result.diagnostics[0].code).toBe('small-corpus-preamble-over-budget');
  });
});

describe('planSectionChunks', () => {
  test('splits at paragraph boundaries and omits descriptions on continuations', async () => {
    const item = page('/guide', 'First block.\n\nSecond block.');
    const first = renderChunkFragments([{ page: item, blocks: ['First block.'], includeDescription: true }]);
    const second = renderChunkFragments([{ page: item, blocks: ['Second block.'], includeDescription: false }]);
    const result = await planSectionChunks({
      pages: [item],
      maxTokens: Math.max(first.length, second.length),
      count: countCharacters,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toContain('Description:');
    expect(result.chunks[1].text).not.toContain('Description:');
    expect(result.chunks[1].text).toContain('Second block.');
  });

  test('keeps fenced code intact and emits an over-budget chunk diagnostic', async () => {
    const fence = '```js\n' + 'x'.repeat(100) + '\n```';
    const result = await planSectionChunks({ pages: [page('/code', fence)], maxTokens: 20, count: countCharacters });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({ overBudget: true, pageIds: ['/code'] });
    expect(result.chunks[0].text).toContain(fence);
    expect(result.diagnostics[0]).toMatchObject({ code: 'corpus-chunk-over-budget', pageId: '/code', part: 1 });
  });

  test('sorts pages by canonical URL before packing', async () => {
    const result = await planSectionChunks({
      pages: [page('/z', 'Z'), page('/a', 'A')],
      maxTokens: 10_000,
      count: countCharacters,
    });
    expect(result.chunks[0].text.indexOf('# a')).toBeLessThan(result.chunks[0].text.indexOf('# z'));
  });
});
