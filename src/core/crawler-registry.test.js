import { describe, expect, test } from 'vitest';
import { CRAWLER_REGISTRY, crawlerRegistryEntry } from './crawler-registry.js';

describe('crawler registry', () => {
  test('is a frozen, release-dated first-party snapshot', () => {
    expect(Object.isFrozen(CRAWLER_REGISTRY)).toBe(true);
    expect(CRAWLER_REGISTRY.map((entry) => entry.token)).toEqual([
      'OAI-SearchBot', 'GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot',
      'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot',
      'Google-Extended', 'bingbot',
    ]);
    for (const entry of CRAWLER_REGISTRY) {
      expect(entry.verifiedAt).toBe('2026-08-12');
      expect(entry.documentationUrl).toMatch(/^https:\/\//);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.purposes)).toBe(true);
    }
  });

  test('looks up canonical spellings case-insensitively', () => {
    expect(crawlerRegistryEntry('gptbot')?.token).toBe('GPTBot');
    expect(crawlerRegistryEntry('UNKNOWN')).toBeUndefined();
  });
});
