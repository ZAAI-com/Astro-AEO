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

  test('robotsTxt.universalAllow defaults to true and is overridable', () => {
    expect(resolveConfig().robotsTxt.universalAllow).toBe(true);
    expect(resolveConfig({ robotsTxt: { universalAllow: false } }).robotsTxt.universalAllow).toBe(false);
  });

  test('domainProfile.email resolves; contact aliases into email with a warning', () => {
    expect(resolveConfig({ domainProfile: { email: 'hi@x.com' } }).domainProfile.email).toBe('hi@x.com');
    const warnings = [];
    const c = resolveConfig({ domainProfile: { contact: 'hi@x.com' } }, { warn: (m) => warnings.push(m) });
    expect(c.domainProfile.email).toBe('hi@x.com');
    expect(warnings.some((w) => w.includes('domainProfile.contact'))).toBe(true);
  });

  test('nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ robotsTxt: { sitemaPath: '/x' } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('robotsTxt.sitemaPath'))).toBe(true);
  });

  test('a valid nested config produces no warnings', () => {
    const warnings = [];
    resolveConfig(
      {
        robotsTxt: { enabled: true, universalAllow: false, allow: ['Googlebot'] },
        domainProfile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' },
        dotmd: { frontmatter: true },
      },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
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
