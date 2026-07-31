import { test, expect, describe } from 'vitest';
import { resolveConfig, resolveSiteMeta } from './config.js';
import { AeoConfigError } from './lib/errors.js';

describe('resolveConfig', () => {
  test('zero-config produces sensible defaults', () => {
    const c = resolveConfig();
    expect(c.include).toEqual(['**']);
    expect(c.dotmd.enabled).toBe(true);
    expect(c.dotmd.linkTag).toBe('auto');
    expect(c.llmsTxt.enabled).toBe(true);
    expect(c.llmsTxt.defaultSection).toBe('Pages');
    expect(c.robotsTxt.enabled).toBe(false);
    expect(c.robotsTxt.sitemapPath).toBe('/sitemap-index.xml');
    expect(c.site.profile.enabled).toBe(false);
    expect(c.sitemap.enabled).toBe(true);
    expect(c.sitemap.options).toEqual({});
    expect(c.sitemapAlias.enabled).toBe(true);
    expect(c.sitemapAlias.sourceFilename).toBe('sitemap-index.xml');
    expect(c.sitemapAlias.outputFilename).toBe('sitemap.xml');
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
    expect(resolveConfig({ domainProfile: { email: 'hi@x.com' } }).site.profile.email).toBe('hi@x.com');
    const warnings = [];
    const c = resolveConfig({ domainProfile: { contact: 'hi@x.com' } }, { warn: (m) => warnings.push(m) });
    expect(c.site.profile.email).toBe('hi@x.com');
    expect(warnings.some((w) => w.includes('domainProfile.contact'))).toBe(true);
  });

  test('nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ robotsTxt: { sitemaPath: '/x' } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('robotsTxt.sitemaPath'))).toBe(true);
  });

  test('sitemap nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ sitemap: { enable: true } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('sitemap.enable'))).toBe(true);
  });

  test('sitemapAlias.sourceFilename derives from the sitemap filenameBase', () => {
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } } }).sitemapAlias.sourceFilename).toBe('sm-index.xml');
    // an explicit sourceFilename wins over the derived default
    expect(resolveConfig({ sitemapAlias: { sourceFilename: 'custom.xml' } }).sitemapAlias.sourceFilename).toBe('custom.xml');
  });

  test('robotsTxt.sitemapPath tracks the sitemap filenameBase so robots.txt points at a real file', () => {
    // A custom filenameBase makes @astrojs/sitemap write `${base}-index.xml`, so the
    // robots.txt Sitemap line must follow suit instead of the hard-coded default.
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } } }).robotsTxt.sitemapPath).toBe('/sm-index.xml');
    // an explicit sitemapPath wins over the derived default
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } }, robotsTxt: { sitemapPath: '/x.xml' } }).robotsTxt.sitemapPath).toBe('/x.xml');
  });

  test('sitemapAlias nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ sitemapAlias: { enabld: true } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('sitemapAlias.enabld'))).toBe(true);
  });

  test('sitemap.options is a passthrough and is never inspected', () => {
    const warnings = [];
    // These are @astrojs/sitemap's options, not ours: flagging them would be wrong.
    resolveConfig(
      { sitemap: { options: { filenameBase: 'sm', customPages: ['https://x/y'], serialize: () => null } } },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
  });

  test('a RegExp option is not walked as if it were a config object', () => {
    const warnings = [];
    // typeof /re/ is "object" and it is not an array, so a naive plain-object check
    // descends into it and flags `source`, `flags`, `lastIndex` as unknown keys.
    resolveConfig({ stripTitleSuffix: /\s*\|\s*Demo$/ }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  test('an unknown top-level key is not descended into', () => {
    const warnings = [];
    resolveConfig({ nope: { alsoNope: true } }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual(['astro-aeo: unknown config key "nope" (ignored)']);
  });

  test('a valid config produces no typo warnings, only migration ones', () => {
    const warnings = [];
    resolveConfig(
      {
        robotsTxt: { enabled: true, universalAllow: false, allow: ['Googlebot'] },
        domainProfile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' },
        dotmd: { frontmatter: true },
      },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
    // domainProfile has moved, so exactly one migration warning is expected.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('`site.profile`');
  });

  test('a valid canonical config produces no warnings at all', () => {
    const warnings = [];
    resolveConfig(
      {
        robotsTxt: { enabled: true, universalAllow: false, allow: ['Googlebot'] },
        site: { profile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' } },
        dotmd: { frontmatter: true },
      },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
  });

  test('site.profile accepts canonical input and legacy input identically', () => {
    const legacy = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', sameAs: ['https://x'] } });
    const canonical = resolveConfig({ site: { profile: { enabled: true, name: 'Acme', sameAs: ['https://x'] } } });
    expect(canonical).toEqual(legacy);
  });

  test('a legacy and canonical value that disagree is a build-stopping error', () => {
    expect(() =>
      resolveConfig({ domainProfile: { name: 'Old' }, site: { profile: { name: 'New' } } }),
    ).toThrow(AeoConfigError);
  });

  test('conflicts throw even with no logger to warn through', () => {
    // Warnings need a sink so they are skipped without a logger, but an error does not.
    expect(() =>
      resolveConfig({ domainProfile: { entityType: 'Person' }, site: { profile: { entityType: 'Blog' } } }),
    ).toThrow(AeoConfigError);
  });
});

describe('resolveSiteMeta fallback chain', () => {
  test('site.name wins', () => {
    const c = resolveConfig({ site: { name: 'A' }, domainProfile: { name: 'B' } });
    expect(resolveSiteMeta(c, 'https://x.com', 'Title').name).toBe('A');
  });

  test('falls back to the profile then title then hostname', () => {
    expect(resolveSiteMeta(resolveConfig({ domainProfile: { name: 'B' } }), 'https://x.com', 'T').name).toBe('B');
    expect(resolveSiteMeta(resolveConfig({ site: { profile: { name: 'B' } } }), 'https://x.com', 'T').name).toBe('B');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', 'T').name).toBe('T');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', '').name).toBe('x.com');
  });
});
