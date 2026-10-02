import { describe, expect, test } from 'vitest';
import { ANALYTICS_CRAWLER_REGISTRY, CRAWLER_REGISTRY_VERSION, CRAWLER_REGISTRY, crawlerRegistryEntry } from './crawler-registry.js';

describe('crawler registry', () => {
  test('is a frozen, release-dated first-party snapshot', () => {
    expect(Object.isFrozen(CRAWLER_REGISTRY)).toBe(true);
    expect(CRAWLER_REGISTRY.map((entry) => entry.token)).toEqual([
      'OAI-SearchBot', 'GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot',
      'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot',
      'Google-Extended', 'bingbot', 'Applebot-Extended', 'Meta-ExternalAgent',
      'Amazonbot', 'CCBot',
    ]);
    for (const entry of CRAWLER_REGISTRY) {
      expect(['2026-08-12', '2026-09-29']).toContain(entry.verifiedAt);
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

 test('versions claimed observable identities separately from robots policy controls', () => {
  expect(CRAWLER_REGISTRY_VERSION).toBe('2');
  expect(Object.isFrozen(ANALYTICS_CRAWLER_REGISTRY)).toBe(true);
  expect(ANALYTICS_CRAWLER_REGISTRY.some((entry) => entry.kind === 'control-token')).toBe(false);
  expect(ANALYTICS_CRAWLER_REGISTRY.map((entry) => entry.token)).toEqual(expect.arrayContaining([
    'Applebot', 'Amzn-SearchBot', 'Amzn-User', 'GPTBot',
  ]));
  expect(CRAWLER_REGISTRY.some((entry) => entry.token === 'Amzn-User')).toBe(false);
});
