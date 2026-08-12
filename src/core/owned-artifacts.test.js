import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { isOwnedArtifactPath } from './owned-artifacts.js';

describe('isOwnedArtifactPath', () => {
  test('recognizes enabled fixed and configurable public artifacts', () => {
    const config = resolveConfig({
      site: { profile: { enabled: true } },
      discovery: {
        robots: { enabled: true },
        sitemap: { alias: { outputFilename: 'index/sitemap.xml' } },
        indexNow: { enabled: true },
      },
    });
    for (const path of [
      '/llms.txt',
      '/llms-full.txt',
      '/robots.txt',
      '/.well-known/astro-aeo-indexnow-v1.json',
      '/.well-known/domain-profile.json',
      '/index/sitemap.xml',
    ]) {
      expect(isOwnedArtifactPath(path, config), path).toBe(true);
    }
  });

  test('does not claim disabled artifacts', () => {
    const config = resolveConfig({
      corpus: { index: { enabled: false }, full: { enabled: false } },
      discovery: { sitemap: { mode: 'disabled' } },
    });
    expect(isOwnedArtifactPath('/llms.txt', config)).toBe(false);
    expect(isOwnedArtifactPath('/sitemap.xml', config)).toBe(false);
    expect(isOwnedArtifactPath('/.well-known/astro-aeo-indexnow-v1.json', config)).toBe(false);
  });

  test('recognizes encoded schema paths in public and request spellings', () => {
    const config = resolveConfig({
      schema: { corpus: { enabled: true, graphPath: '/schema/graph%20map.jsonld' } },
    });

    expect(isOwnedArtifactPath('/schema/graph%20map.jsonld', config)).toBe(true);
    expect(isOwnedArtifactPath('/schema/graph map.jsonld', config)).toBe(true);
  });
});
