import { test, expect, describe } from 'vitest';
import { resolveConfig, resolveSiteMeta } from './config.js';
import { AeoConfigError } from './lib/errors.js';

describe('resolveConfig', () => {
  test('zero-config produces sensible defaults', () => {
    const c = resolveConfig();
    expect(c.pages.include).toEqual(['**']);
    expect(c.markdown.enabled).toBe(true);
    expect(c.markdown.alternateLink).toBe('auto');
    expect(c.corpus.index.enabled).toBe(true);
    expect(c.corpus.index.defaultSection).toBe('Pages');
    expect(c.corpus.full.mode).toBe('all');
    expect(c.corpus.urlMap.enabled).toBe(false);
    expect(c.corpus.runtime.maxPages).toBe(50);
    expect(c.discovery.robots.enabled).toBe(false);
    expect(c.discovery.robots.sitemapPath).toBe('/sitemap-index.xml');
    expect(c.site.profile.enabled).toBe(false);
    expect(c.discovery.sitemap.mode).toBe('auto');
    expect(c.discovery.sitemap.options).toEqual({});
    expect(c.discovery.sitemap.alias.enabled).toBe(true);
    expect(c.discovery.sitemap.alias.sourceFilename).toBe('sitemap-index.xml');
    expect(c.discovery.sitemap.alias.outputFilename).toBe('sitemap.xml');
    expect(c.discovery.robots.sitemapPolicy).toBe('auto');
  });

  test('runtime corpus limits are bounded by default and explicitly overridable', () => {
    expect(resolveConfig({ corpus: { runtime: { maxPages: 12 } } }).corpus.runtime.maxPages).toBe(12);
    expect(resolveConfig({ corpus: { runtime: { maxPages: 'unlimited' } } }).corpus.runtime.maxPages).toBe('unlimited');
    expect(() => resolveConfig({ corpus: { runtime: { maxPages: 0 } } })).toThrow(AeoConfigError);
    expect(() => resolveConfig({ corpus: { runtime: { maxPages: 1.5 } } })).toThrow(AeoConfigError);
  });

  test('page catalog descriptors require a non-empty module', () => {
    expect(resolveConfig({ pages: { catalogs: [{ module: './catalog.js' }] } }).pages.catalogs)
      .toEqual([{ module: './catalog.js' }]);
    expect(() => resolveConfig({ pages: { catalogs: [{}] } })).toThrow(/pages\.catalogs\[0\]\.module/);
    expect(() => resolveConfig({ pages: { catalogs: [{ module: '  ' }] } })).toThrow(AeoConfigError);
    expect(() => resolveConfig({ pages: { catalogs: /** @type {any} */ ({}) } })).toThrow(AeoConfigError);
  });

  test('dotmdMetadata is aliased to markdown.frontmatter with a warning', () => {
    const warnings = [];
    const c = resolveConfig({ dotmd: { dotmdMetadata: true } }, { warn: (m) => warnings.push(m) });
    expect(c.markdown.frontmatter).toBe(true);
    expect(warnings.some((w) => w.includes('dotmdMetadata'))).toBe(true);
  });

  test('the 1.0-era frontmatter alias keeps its original precedence', () => {
    // `frontmatter` won over `dotmdMetadata` in 1.0 and must still win after the move.
    expect(resolveConfig({ dotmd: { frontmatter: true, dotmdMetadata: false } }).markdown.frontmatter).toBe(true);
    expect(resolveConfig({ dotmd: { frontmatter: false, dotmdMetadata: true } }).markdown.frontmatter).toBe(false);
  });

  test('corpus accepts canonical input and legacy input identically', () => {
    const legacy = resolveConfig({
      llmsTxt: { showLastmod: true, includeNoDotmd: true },
      llmsFullTxt: { mode: 'index' },
      urlMap: { enabled: true },
    });
    const canonical = resolveConfig({
      corpus: {
        index: { showLastModified: true, includeHtmlOnly: true },
        full: { mode: 'index' },
        urlMap: { enabled: true },
      },
    });
    expect(canonical).toEqual(legacy);
  });

  test('the three 1.0 corpus blocks share one migration warning', () => {
    const warnings = [];
    resolveConfig(
      { llmsTxt: { showLastmod: true }, llmsFullTxt: { mode: 'index' }, urlMap: { enabled: true } },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('`llmsTxt`, `llmsFullTxt`, `urlMap`');
    expect(warnings[0]).toContain('`corpus`');
  });

  test('markdown accepts canonical input and legacy input identically', () => {
    const legacy = resolveConfig({ dotmd: { linkTag: 'never', frontmatter: true } });
    const canonical = resolveConfig({ markdown: { alternateLink: 'never', frontmatter: true } });
    expect(canonical).toEqual(legacy);
  });

  test('unknown keys warn', () => {
    const warnings = [];
    resolveConfig({ nope: 1 }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  test('robotsTxt.universalAllow defaults to true and is overridable', () => {
    expect(resolveConfig().discovery.robots.universalAllow).toBe(true);
    expect(resolveConfig({ robotsTxt: { universalAllow: false } }).discovery.robots.universalAllow).toBe(false);
    expect(resolveConfig({ discovery: { robots: { universalAllow: false } } }).discovery.robots.universalAllow).toBe(false);
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
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } } }).discovery.sitemap.alias.sourceFilename).toBe('sm-index.xml');
    // an explicit sourceFilename wins over the derived default
    expect(resolveConfig({ sitemapAlias: { sourceFilename: 'custom.xml' } }).discovery.sitemap.alias.sourceFilename).toBe('custom.xml');
    // the derivation must read the MERGED config, so canonical input derives too
    expect(resolveConfig({ discovery: { sitemap: { options: { filenameBase: 'sm' } } } }).discovery.sitemap.alias.sourceFilename).toBe('sm-index.xml');
  });

  test('robotsTxt.sitemapPath tracks the sitemap filenameBase so robots.txt points at a real file', () => {
    // A custom filenameBase makes @astrojs/sitemap write `${base}-index.xml`, so the
    // robots.txt Sitemap line must follow suit instead of the hard-coded default.
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } } }).discovery.robots.sitemapPath).toBe('/sm-index.xml');
    // an explicit sitemapPath wins over the derived default
    expect(resolveConfig({ sitemap: { options: { filenameBase: 'sm' } }, robotsTxt: { sitemapPath: '/x.xml' } }).discovery.robots.sitemapPath).toBe('/x.xml');
    // A 1.0-only project must not silently regress to the default base while its
    // real sitemap is named `sm-index.xml`. This is the derivation-ordering guard.
    expect(resolveConfig({ discovery: { sitemap: { options: { filenameBase: 'sm' } } } }).discovery.robots.sitemapPath).toBe('/sm-index.xml');
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
      { discovery: { sitemap: { options: { filenameBase: 'sm', customPages: ['https://x/y'], serialize: () => null } } } },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
  });

  test('a RegExp option is not walked as if it were a config object', () => {
    const warnings = [];
    // typeof /re/ is "object" and it is not an array, so a naive plain-object check
    // descends into it and flags `source`, `flags`, `lastIndex` as unknown keys.
    // Now that this option lives at depth 2 the recursive walker actually reaches it.
    const c = resolveConfig({ pages: { stripTitleSuffix: /\s*\|\s*Demo$/ } }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(c.pages.stripTitleSuffix).toBeInstanceOf(RegExp);
  });

  test('a RegExp survives the legacy lift by reference', () => {
    const re = /\s*\|\s*Demo$/;
    expect(resolveConfig({ stripTitleSuffix: re }).pages.stripTitleSuffix).toBe(re);
  });

  test('page options accept canonical input and legacy input identically', () => {
    const legacy = resolveConfig({ include: ['/a/**'], exclude: ['/b'], respectNoindex: false });
    const canonical = resolveConfig({ pages: { include: ['/a/**'], exclude: ['/b'], respectNoindex: false } });
    expect(canonical).toEqual(legacy);
  });

  test('an equal RegExp on both sides is not a conflict, since it compares by source and flags', () => {
    const warnings = [];
    const c = resolveConfig(
      { stripTitleSuffix: /x$/i, pages: { stripTitleSuffix: /x$/i } },
      { warn: (m) => warnings.push(m) },
    );
    expect(String(c.pages.stripTitleSuffix)).toBe('/x$/i');
    expect(warnings.some((w) => w.includes('both set to the same values'))).toBe(true);
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
    // domainProfile, dotmd, and robotsTxt have all moved, so one warning each.
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes('`site.profile`'))).toBe(true);
    expect(warnings.some((w) => w.includes('`markdown`'))).toBe(true);
    expect(warnings.some((w) => w.includes('`discovery`'))).toBe(true);
  });

  test('a valid canonical config produces no warnings at all', () => {
    const warnings = [];
    resolveConfig(
      {
        site: { profile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' } },
        markdown: { frontmatter: true },
        discovery: { robots: { enabled: true, allow: ['Googlebot'] } },
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

describe('robots sitemap tri-state', () => {
  // Omitted, true, and false are three distinct states, and the omitted one is the
  // default. Collapsing it to a boolean anywhere silently changes whether the
  // robots.txt Sitemap line is verified against the build output.
  const policy = (cfg) => resolveConfig(cfg).discovery.robots.sitemapPolicy;

  test('absent on both sides is auto', () => {
    expect(policy({})).toBe('auto');
    expect(policy({ robotsTxt: {} })).toBe('auto');
    // An explicit undefined must behave exactly like an omitted key.
    expect(policy({ robotsTxt: { includeSitemap: undefined } })).toBe('auto');
  });

  test('canonical alone resolves', () => {
    expect(policy({ discovery: { robots: { includeSitemap: true } } })).toBe('always');
    expect(policy({ discovery: { robots: { includeSitemap: false } } })).toBe('never');
  });

  test('legacy alone resolves', () => {
    expect(policy({ robotsTxt: { includeSitemap: true } })).toBe('always');
    expect(policy({ robotsTxt: { includeSitemap: false } })).toBe('never');
  });

  test('equal on both sides resolves and warns once', () => {
    const warnings = [];
    const c = resolveConfig(
      { robotsTxt: { includeSitemap: false }, discovery: { robots: { includeSitemap: false } } },
      { warn: (m) => warnings.push(m) },
    );
    expect(c.discovery.robots.sitemapPolicy).toBe('never');
    expect(warnings.filter((w) => w.includes('both set to the same values'))).toHaveLength(1);
  });

  test('disagreeing on the two sides is an error', () => {
    expect(() =>
      resolveConfig({ robotsTxt: { includeSitemap: true }, discovery: { robots: { includeSitemap: false } } }),
    ).toThrow(AeoConfigError);
  });

  test('includeSitemap stays equivalent to the old `?? true` boolean', () => {
    expect(resolveConfig({}).discovery.robots.includeSitemap).toBe(true);
    expect(resolveConfig({ robotsTxt: { includeSitemap: true } }).discovery.robots.includeSitemap).toBe(true);
    expect(resolveConfig({ robotsTxt: { includeSitemap: false } }).discovery.robots.includeSitemap).toBe(false);
  });
});

describe('discovery.sitemap.mode', () => {
  test.each([undefined, true, false])(
    'disabled mode suppresses robots sitemap inclusion when includeSitemap is %s',
    (includeSitemap) => {
      const robots = includeSitemap === undefined ? {} : { includeSitemap };
      const c = resolveConfig({
        discovery: { sitemap: { mode: 'disabled' }, robots },
      });
      expect(c.discovery.robots.sitemapPolicy).toBe('never');
      expect(c.discovery.robots.includeSitemap).toBe(false);
    },
  );

  test('the 1.0 boolean maps onto the tri-state mode', () => {
    // `enabled: false` never meant "no sitemap", only "do not auto-register", so it
    // maps to 'external' rather than 'disabled'.
    expect(resolveConfig({ sitemap: { enabled: true } }).discovery.sitemap.mode).toBe('auto');
    expect(resolveConfig({ sitemap: { enabled: false } }).discovery.sitemap.mode).toBe('external');
  });

  test('a legacy boolean and a canonical mode that agree do not conflict', () => {
    const warnings = [];
    const c = resolveConfig(
      { sitemap: { enabled: false }, discovery: { sitemap: { mode: 'external' } } },
      { warn: (m) => warnings.push(m) },
    );
    expect(c.discovery.sitemap.mode).toBe('external');
    expect(warnings.filter((w) => w.includes('both set to the same values'))).toHaveLength(1);
  });

  test('a legacy boolean that disagrees with the canonical mode is an error', () => {
    expect(() =>
      resolveConfig({ sitemap: { enabled: false }, discovery: { sitemap: { mode: 'auto' } } }),
    ).toThrow(AeoConfigError);
  });

  test('discovery accepts canonical input and legacy input identically', () => {
    const legacy = resolveConfig({
      sitemap: { enabled: false, options: { filenameBase: 'sm' } },
      sitemapAlias: { outputFilename: 'map.xml' },
      robotsTxt: { enabled: true, allow: ['Googlebot'] },
    });
    const canonical = resolveConfig({
      discovery: {
        sitemap: { mode: 'external', options: { filenameBase: 'sm' }, alias: { outputFilename: 'map.xml' } },
        robots: { enabled: true, allow: ['Googlebot'] },
      },
    });
    expect(canonical).toEqual(legacy);
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
