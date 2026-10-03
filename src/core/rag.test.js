import { expect, test } from 'vitest';
import { planRagRecords, isRagRecord, serializeRagRecords, validateRagReplacement } from './rag.js';
import { countApproximateTokens, BUILTIN_TOKENIZER_IDENTITY } from './corpus-tokenizer.js';
import { sha256Digest } from './corpus-manifest.js';

const page = (pathname = '/guide', extra = {}) => ({ pathname, url: `https://example.test${pathname}`,
  canonicalUrl: `https://example.test${pathname}`, title: 'Guide', locale: 'en', language: 'en',
  markdown: '# Guide\n\nFirst paragraph.\n\n## Next\n\nSecond paragraph.',
  source: { body: 'RAW MDX SECRET <Component />' }, html: '<main>RAW HTML</main>', ...extra });
const input = { maxTokens: 14, tokenizer: BUILTIN_TOKENIZER_IDENTITY, count: async (text) => countApproximateTokens(text) };

test('records disclose actual tokenizer counts, hashes, headings, flat metadata and no raw source', async () => {
  const { records } = await planRagRecords([page()], input);
  expect(records.map((item) => item.kind)).toEqual(['page','chunk','chunk']);
  for (const record of records) {
    expect(isRagRecord(record)).toBe(true);
    expect(record.tokenCount).toBe(countApproximateTokens(record.text));
    expect(record.hash).toBe(await sha256Digest(record.text));
    expect(record.pageHash).toBe(records[0].hash);
    expect(record.tokenizer).toEqual(BUILTIN_TOKENIZER_IDENTITY);
  }
  expect(records[2].headings).toEqual(['# Guide','## Next']);
  expect(records[2].text).toBe('## Next\n\nSecond paragraph.');
  expect(serializeRagRecords(records)).not.toMatch(/RAW MDX|Component|RAW HTML|source/);
});

test('stable identities survive edits and input reordering but distinguish locale/version/origin', async () => {
  const before = await planRagRecords([page('/a'), page('/b')], input);
  const after = await planRagRecords([page('/b'), page('/a', { markdown: '# Guide\n\nEdited paragraph.\n\n## Next\n\nSecond paragraph.' })], input);
  expect(before.records.map((record) => record.id)).toEqual(after.records.map((record) => record.id));
  expect(before.records[0].pageHash).not.toBe(after.records[0].pageHash);
  const identities = await planRagRecords([page(),page('/guide',{locale:'de'}),page('/guide',{version:'v1'}),
    page('/guide',{canonicalUrl:'https://other.test/guide'})], input);
  expect(new Set(identities.records.filter((record) => record.kind === 'page').map((record) => record.id)).size).toBe(4);
  await expect(planRagRecords([page(),page()], input)).rejects.toThrow(/Duplicate/);
});

test('indivisible fences and headings stay whole, even oversized and with non-additive counters', async () => {
  const text = '## Fence\n\n```js\nconst x = "' + 'long '.repeat(40) + '";\n```';
  const { records, diagnostics } = await planRagRecords([page('/code',{markdown:text})], input);
  expect(records[1].text).toBe(text);
  expect(records[1].oversized).toBe(true);
  expect(diagnostics).toEqual([expect.objectContaining({code:'rag-chunk-over-budget',pathname:'/code'})]);
  const nonAdditive = await planRagRecords([page()], { ...input, maxTokens: 5,
    count: async (text) => text.includes('Second') && text.includes('First') ? 10 : 1 });
  expect(nonAdditive.records.slice(1)).toHaveLength(2);
  expect(nonAdditive.records.slice(1).every((record) => record.tokenCount === 1)).toBe(true);
});

test('respects corpus exclusions and indexing/text directives without full-corpus truncation', async () => {
  const excluded = [{corpusExcluded:true},{directives:{index:false}},{directives:{includeInLlms:false}},
    {directives:{includeInLlmsFull:false}},{aeoTokens:['no-llms-full']}];
  expect((await planRagRecords(excluded.map((extra,index) => page(`/skip${index}`,extra)), input)).records).toEqual([]);
  const empty = await planRagRecords([page('/empty',{markdown:''})],input);
  expect(empty.records).toHaveLength(1);
  expect(empty.records[0].tokenCount).toBe(0);
});

test('metadata replacements preserve protected identity/measurement and reject nested/raw payloads', async () => {
  const original = (await planRagRecords([page()],input)).records[0];
  expect(validateRagReplacement({...original,metadata:{...original.metadata,category:'guide'}}, original)).toBe(true);
  for (const change of [{text:'forged'},{tokenCount:123},{hash:'sha256:'+'0'.repeat(64)},
    {metadata:{...original.metadata,url:'https://evil.test'}},{metadata:{...original.metadata,nested:{secret:'raw'}}},
    {metadata:{...original.metadata,value:Infinity}},{unknown:'extra'}])
    expect(validateRagReplacement({...original,...change},original)).toBe(false);
});

test('canonical metadata omits query/fragment and refuses credentials or non-HTTP sources', async () => {
  expect((await planRagRecords([page('/x',{canonicalUrl:'https://example.test/x?secret=1#fragment'})],input)).records[0].metadata.url)
    .toBe('https://example.test/x');
  for (const canonicalUrl of ['https://user:password@example.test/x','file:///private/source'])
    await expect(planRagRecords([page('/x',{canonicalUrl})],input)).rejects.toThrow(/public HTTP/);
});


test('continuation chunks carry heading context without repeating text or creating orphan headings', async () => {
  const text = '# Parent\n\n## Section\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
  const { records } = await planRagRecords([page('/heading',{markdown:text})],{...input,maxTokens:12});
  const chunks = records.slice(1);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.at(-1).headings).toEqual(['# Parent','## Section']);
  expect(chunks.at(-1).text).not.toContain('## Section');
  expect(chunks.map(record=>record.text).join('\n\n')).toBe(text);
});


test('distinct routes sharing an authored canonical remain separate stable records', async () => {
  const { records } = await planRagRecords([page('/guide'),page('/alias',{canonicalUrl:'https://example.test/guide'})],input);
  const pages=records.filter(record=>record.kind==='page');
  expect(pages).toHaveLength(2);
  expect(pages[0].id).not.toBe(pages[1].id);
  expect(new Set(pages.map(record=>record.metadata.url)).size).toBe(1);
});
