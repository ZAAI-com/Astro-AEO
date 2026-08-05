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
      },
    });
    for (const path of [
      '/llms.txt',
      '/llms-full.txt',
      '/robots.txt',
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
  });
});
