import { describe, expect, test } from 'vitest';
import {
  BUILTIN_CORPUS_TOKENIZER,
  CorpusTokenizerError,
  countApproximateTokens,
  countCorpusTokens,
  normalizePublishedText,
  probeCorpusTokenizer,
  runCorpusPlanWithTokenizer,
  validateCorpusTokenizerModule,
} from './corpus-tokenizer.js';

describe('astro-aeo-approx@1', () => {
  test('normalizes line endings and ignores whitespace', () => {
    expect(normalizePublishedText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(countApproximateTokens(' \r\n\t')).toBe(0);
  });

  test('counts Latin runs in four-code-point units', () => {
    expect(countApproximateTokens('abcd')).toBe(1);
    expect(countApproximateTokens('abcde')).toBe(2);
    expect(countApproximateTokens('Astro_AEO123')).toBe(3);
    expect(countApproximateTokens('Cafe\u0301')).toBe(2);
  });

  test('counts each non-Latin letter, number, punctuation, or symbol', () => {
    expect(countApproximateTokens('東京。')).toBe(3);
    expect(countApproximateTokens('🌍!')).toBe(2);
    expect(countApproximateTokens('a 東京 b')).toBe(4);
  });
});

describe('custom corpus tokenizers', () => {
  const module = (overrides = {}) => ({
    apiVersion: 1,
    name: 'exact-test',
    version: '2',
    approximate: false,
    count: (text) => text.length,
    ...overrides,
  });

  test('validates identity and count shape', () => {
    expect(validateCorpusTokenizerModule(module(), './tokenizer.js')).toMatchObject({
      apiVersion: 1,
      name: 'exact-test',
      version: '2',
      approximate: false,
    });
    expect(() => validateCorpusTokenizerModule(module({ version: '' }), 'bad')).toThrow(/non-empty version/);
    expect(() => validateCorpusTokenizerModule(module({ apiVersion: 2 }), 'bad')).toThrow(/apiVersion: 1/);
  });

  test('passes normalized text and immutable options to count()', async () => {
    let received;
    const tokenizer = module({
      count(text, options) {
        received = { text, options, frozen: Object.isFrozen(options) };
        return 4;
      },
    });
    const result = await runCorpusPlanWithTokenizer(tokenizer, { model: 'x' }, async ({ count }) => count('a\r\nb'));
    expect(result.result).toBe(4);
    expect(received).toEqual({ text: 'a\nb', options: { model: 'x' }, frozen: true });
  });

  test('rejects invalid and nondeterministic counts', async () => {
    await expect(countCorpusTokens(module({ count: () => -1 }), 'x')).rejects.toBeInstanceOf(CorpusTokenizerError);
    let value = 0;
    await expect(probeCorpusTokenizer(module({ count: () => value++ }))).rejects.toThrow(/not deterministic/);
  });

  test('discards a partial plan and reruns wholly with the built-in tokenizer', async () => {
    let calls = 0;
    let plans = 0;
    const custom = module({
      count(text) {
        calls++;
        if (calls > 8) throw new Error('late failure');
        return text.length;
      },
    });
    const result = await runCorpusPlanWithTokenizer(custom, undefined, async ({ count }) => {
      plans++;
      return count('abcdefgh');
    });
    expect(plans).toBe(2);
    expect(result.result).toBe(BUILTIN_CORPUS_TOKENIZER.count('abcdefgh'));
    expect(result.tokenizer).toMatchObject({ name: 'astro-aeo-approx', version: '1' });
    expect(result.fallback).toMatchObject({ name: 'exact-test' });
  });

  test('does not disguise a planner failure as a tokenizer failure', async () => {
    await expect(runCorpusPlanWithTokenizer(module(), undefined, async () => {
      throw new Error('planner bug');
    })).rejects.toThrow('planner bug');
  });
});
