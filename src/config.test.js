import { test, expect, describe } from 'vitest';
import { resolveConfig, resolveSiteMeta } from './config.js';

describe('resolveConfig', () => {
  test('zero-config produces sensible defaults', () => {
    const c = resolveConfig();
    expect(c.include).toEqual(['**']);
    expect(c.dotmd.enabled).toBe(true);
    expect(c.dotmd.linkTag).toBe('auto');
    expect(c.llmsTxt.enabled).toBe(true);
    expect(c.llmsTxt.defaultSection).toBe('Pages');
    expect(c.robotsTxt.enabled).toBe(false);
    expect(c.domainProfile.enabled).toBe(false);
  });

  test('dotmdMetadata is aliased to frontmatter with a warning', () => {
    const warnings = [];
    const c = resolveConfig({ dotmd: { dotmdMetadata: true } }, { warn: (m) => warnings.push(m) });
    expect(c.dotmd.frontmatter).toBe(true);
    expect(warnings.some((w) => w.includes('dotmdMetadata'))).toBe(true);
  });

  test('unknown keys warn', () => {
    const warnings = [];
    resolveConfig({ nope: 1 }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });
});

describe('resolveSiteMeta fallback chain', () => {
  test('site.name wins', () => {
    const c = resolveConfig({ site: { name: 'A' }, domainProfile: { name: 'B' } });
    expect(resolveSiteMeta(c, 'https://x.com', 'Title').name).toBe('A');
  });

  test('falls back to domainProfile then title then hostname', () => {
    expect(resolveSiteMeta(resolveConfig({ domainProfile: { name: 'B' } }), 'https://x.com', 'T').name).toBe('B');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', 'T').name).toBe('T');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', '').name).toBe('x.com');
  });
});
