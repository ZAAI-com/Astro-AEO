import { test, expect, describe } from 'vitest';
import { resolveConfig, resolveSiteMeta } from './config.js';
import { AeoConfigError } from './lib/errors.js';

describe('resolveConfig', () => {
  test('normalizes strict per-origin domain-profile overrides', () => {
    const origins = { 'https://FR.example.test/': { name: 'Français', sameAs: ['https://example.test/about'] } };
    const c = resolveConfig({ site: { profile: { origins } } });
    expect(c.site.profile.origins).toEqual({ 'https://fr.example.test': origins['https://FR.example.test/'] });
    expect(c.site.profile.origins['https://fr.example.test'].sameAs).not.toBe(origins['https://FR.example.test/'].sameAs);
    for (const invalid of [
      [], { 'https://example.test/path': {} }, { 'https://user:secret@example.test': {} },
      { 'https://example.test?q=secret': {} }, { 'https://example.test': { enabled: true } },
      { 'https://example.test': { sameAs: [1] } }, { 'https://example.test': { sameAs: new Array(1) } }, { 'https://example.test': { name: 42 } },
      { 'https://example.test': { entityType: 'Spaceship' } },
      { 'https://example.test': {}, 'https://EXAMPLE.test/': {} },
    ]) expect(() => resolveConfig({ site: { profile: { origins: invalid } } })).toThrow(/site.profile.origins/);
  });

  test('zero-config produces sensible defaults', () => {
    const c = resolveConfig();
    expect(c.pages.include).toEqual(['**']);
    expect(c.pages.devDynamicDiscovery).toBe('startup');
    expect(c.markdown.enabled).toBe(true);
    expect(c.markdown.alternateLink).toBe('auto');
    expect(c.corpus.index.enabled).toBe(true);
    expect(c.corpus.index.defaultSection).toBe('Pages');
    expect(c.corpus.full.mode).toBe('all');
    expect(c.corpus.urlMap.enabled).toBe(false);
    expect(c.corpus.runtime.maxPages).toBe(50);
    expect(c.corpus.small).toEqual({ enabled: false, maxTokens: 20_000 });
    expect(c.corpus.chunks).toEqual({ enabled: false, maxTokensPerFile: 100_000, by: 'section' });
    expect(c.corpus.manifest).toEqual({ enabled: false });
    expect(c.corpus.tokenizer).toBeUndefined();
    expect(c.corpus.compression).toEqual({ gzip: false });
    expect(c.i18n).toEqual({ indexes: 'auto', unresolvedLanguage: 'default' });
    expect(c.cache).toEqual({ enabled: true });
    expect(c.discovery.robots.enabled).toBe(false);
    expect(c.discovery.robots.policy).toBe('custom');
    expect(c.discovery.robots.contentSignals).toBeUndefined();
    expect(c.discovery.robots.sitemapPath).toBe('/sitemap-index.xml');
    expect(c.site.profile.enabled).toBe(false);
    expect(c.discovery.sitemap.mode).toBe('auto');
    expect(c.discovery.sitemap.options).toEqual({});
    expect(c.discovery.sitemap.alias.enabled).toBe(true);
    expect(c.discovery.sitemap.alias.sourceFilename).toBe('sitemap-index.xml');
    expect(c.discovery.sitemap.alias.outputFilename).toBe('sitemap.xml');
    expect(c.discovery.robots.sitemapPolicy).toBe('auto');
    expect(c.site.defaultLocale).toBeUndefined();
    expect(c.markdown.strategy).toBe('auto');
    expect(c.markdown.renderers).toEqual([]);
    expect(c.artifacts.replace).toEqual([]);
    expect(c.metadata).toEqual({ fillMissing: false, defaults: {} });
    expect(c.schema).toEqual({
      autoInject: true,
      infer: ['website', 'webpage', 'breadcrumbs'],
      strictReferences: true,
      corpus: {
        enabled: false,
        graphPath: '/schema/graph.jsonld',
        mapPath: '/schema/schema-map.xml',
      },
    });
    expect(c.validation).toEqual({ onBuild: 'artifacts', failOn: 'error' });
    expect(c.plugins).toEqual([]);
    expect(c.discovery.indexNow).toEqual({
      enabled: false,
      submit: 'changed',
      state: 'public',
      strict: false,
      key: { source: 'env', name: 'ASTRO_AEO_INDEXNOW_KEY' },
      keyLocation: undefined,
      origins: [],
    });
  });

  test('resolves only the active 1.2 configuration groups', () => {
    const organization = { '@type': 'Organization', name: 'Acme' };
    const plugin = { name: 'example', apiVersion: 1, setup() {} };
    const c = resolveConfig({
      site: { defaultLocale: 'en', organization },
      markdown: { strategy: 'auto', renderers: [{ module: './renderer.js', options: { safe: true } }] },
      artifacts: { replace: ['/answer.md'] },
      metadata: { fillMissing: true, defaults: { title: 'Default' } },
      schema: {
        autoInject: false,
        infer: ['webpage'],
        strictReferences: false,
        corpus: { enabled: true, graphPath: '/g.jsonld', mapPath: '/m.xml' },
      },
      validation: { onBuild: 'recommended', failOn: 'warning' },
      plugins: [plugin],
    });
    expect(c).toMatchObject({
      site: { defaultLocale: 'en', organization },
      artifacts: { replace: ['/answer.md'] },
      metadata: { fillMissing: true, defaults: { title: 'Default' } },
      schema: { autoInject: false, infer: ['webpage'], strictReferences: false },
      validation: { onBuild: 'recommended', failOn: 'warning' },
    });
    expect(c.plugins).toEqual([plugin]);
    expect(c.plugins[0]).not.toBe(plugin);
  });

  test('renderer descriptors use strict JSON and reserve one MDX slot', () => {
    expect(resolveConfig({ markdown: { renderers: [() => ({ status: 'decline' })] } }).markdown.renderers)
      .toHaveLength(1);
    expect(() => resolveConfig({ markdown: { renderers: [{ module: '' }] } })).toThrow(/module/);
    expect(() => resolveConfig({ markdown: { renderers: [
      { module: 'astro-aeo/mdx' }, { module: 'astro-aeo/mdx' },
    ] } })).toThrow(/only once/);
    expect(() => resolveConfig({ markdown: { renderers: [{ module: './x.js', options: { run() {} } }] } }))
      .toThrow(/strict JSON/);
  });

  test('artifact replacement and schema corpus paths must be exact and distinct', () => {
    for (const path of [
      'relative.md', '/../secret', '/x/*', '/x/', '/x?query=1', '/x%2fsecret',
      '/%61.txt', '/café.json', '/caf%c3%a9.json', '/literal%2520escape.txt',
    ]) {
      expect(() => resolveConfig({ artifacts: { replace: [path] } })).toThrow(/artifacts\.replace/);
    }
    expect(() => resolveConfig({ artifacts: { replace: ['/x', '/x'] } })).toThrow(/duplicate/);
    expect(resolveConfig({ artifacts: { replace: ['/sale-100%25.txt'] } }).artifacts.replace)
      .toEqual(['/sale-100%25.txt']);
    expect(() => resolveConfig({ schema: { corpus: { graphPath: '/same', mapPath: '/same' } } }))
      .toThrow(/must be different/);
  });

  test('plugin definitions fail configuration before setup', () => {
    const setup = () => {};
    expect(() => resolveConfig({ plugins: [
      { name: 'same', apiVersion: 1, setup },
      { name: 'same', apiVersion: 1, setup },
    ] })).toThrow(/duplicate/);
    expect(() => resolveConfig({ plugins: [{ name: 'astro-aeo:user', apiVersion: 1, setup }] }))
      .toThrow(/reserved/);
    expect(() => resolveConfig({ plugins: [{ name: ' astro-aeo:user ', apiVersion: 1, setup }] }))
      .toThrow(/reserved/);
    expect(() => resolveConfig({ plugins: [
      { name: 'same', apiVersion: 1, setup },
      { name: ' same ', apiVersion: 1, setup },
    ] })).toThrow(/duplicate/);
    expect(() => resolveConfig({ plugins: [{ name: 'wrong', apiVersion: 2, setup }] })).toThrow(/apiVersion/);
    expect(() => resolveConfig({ plugins: [{ name: 'runtime', apiVersion: 1, setup, runtime: {
      entrypoint: './runtime.js', options: { invalid: new Date() },
    } }] })).toThrow(/plain JSON/);
  });

  test('plugin descriptors normalize names and detach strict runtime options', () => {
    const options = { nested: { label: 'original' } };
    const runtime = { entrypoint: './runtime.js', options };
    const plugin = { name: ' example ', apiVersion: 1, setup() {}, runtime };
    const resolved = resolveConfig({ plugins: [plugin] }).plugins[0];

    expect(resolved).not.toBe(plugin);
    expect(resolved.name).toBe('example');
    expect(resolved.runtime).not.toBe(runtime);
    expect(resolved.runtime.options).not.toBe(options);
    expect(resolved.runtime.options).toEqual(options);

    options.nested.label = 'mutated';
    runtime.entrypoint = './changed.js';
    plugin.name = 'changed';
    expect(resolved).toMatchObject({
      name: 'example',
      runtime: { entrypoint: './runtime.js', options: { nested: { label: 'original' } } },
    });
  });

  test('runtime corpus limits are bounded by default and explicitly overridable', () => {
    expect(resolveConfig({ corpus: { runtime: { maxPages: 12 } } }).corpus.runtime.maxPages).toBe(12);
    expect(resolveConfig({ corpus: { runtime: { maxPages: 'unlimited' } } }).corpus.runtime.maxPages).toBe('unlimited');
    expect(() => resolveConfig({ corpus: { runtime: { maxPages: 0 } } })).toThrow(AeoConfigError);
    expect(() => resolveConfig({ corpus: { runtime: { maxPages: 1.5 } } })).toThrow(AeoConfigError);
  });

  test('resolves corpus planning, locale, and cache options', () => {
    const tokenizerOptions = { model: 'example', nested: { enabled: true } };
    const c = resolveConfig({
      corpus: {
        small: { enabled: true, maxTokens: 123 },
        chunks: { enabled: true, maxTokensPerFile: 456, by: 'section' },
        manifest: { enabled: true },
        tokenizer: { module: './tokenizer.js', options: tokenizerOptions },
        compression: { gzip: true },
      },
      i18n: { indexes: 'both', unresolvedLanguage: 'exclude' },
      cache: { enabled: false },
    });

    expect(c).toMatchObject({
      corpus: {
        small: { enabled: true, maxTokens: 123 },
        chunks: { enabled: true, maxTokensPerFile: 456, by: 'section' },
        manifest: { enabled: true },
        tokenizer: { module: './tokenizer.js', options: tokenizerOptions },
        compression: { gzip: true },
      },
      i18n: { indexes: 'both', unresolvedLanguage: 'exclude' },
      cache: { enabled: false },
    });
    expect(c.corpus.tokenizer.options).not.toBe(tokenizerOptions);
  });

  test('rejects invalid corpus planning and locale options', () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveConfig({ corpus: { small: { maxTokens: value } } }))
        .toThrow(/positive safe integer/);
      expect(() => resolveConfig({ corpus: { chunks: { maxTokensPerFile: value } } }))
        .toThrow(/positive safe integer/);
    }
    expect(() => resolveConfig({ corpus: { chunks: { by: /** @type {any} */ ('page') } } }))
      .toThrow(/corpus\.chunks\.by/);
    expect(() => resolveConfig({ corpus: { small: /** @type {any} */ (true) } }))
      .toThrow(/corpus\.small must be an object/);
    expect(() => resolveConfig({ corpus: { tokenizer: { module: 'https://example.com/tokenizer.js' } } }))
      .toThrow(/must be local/);
    expect(() => resolveConfig({ corpus: { tokenizer: { module: './tokenizer.js', options: { run() {} } } } }))
      .toThrow(/strict JSON/);
    expect(() => resolveConfig({ i18n: { indexes: /** @type {any} */ ('everywhere') } }))
      .toThrow(/i18n\.indexes/);
    expect(() => resolveConfig({ i18n: { unresolvedLanguage: /** @type {any} */ ('guess') } }))
      .toThrow(/i18n\.unresolvedLanguage/);
    expect(() => resolveConfig({ corpus: {
      index: { enabled: false },
      full: { enabled: false },
      small: { enabled: false },
      chunks: { enabled: false },
      manifest: { enabled: true },
    } })).toThrow(/manifest\.enabled requires/);
  });

  test('resolves crawler policy and explicit Content Signals', () => {
    const c = resolveConfig({ discovery: { robots: {
      enabled: true,
      policy: 'retrieval-only',
      allow: ['Claude-User'],
      disallow: ['GPTBot'],
      contentSignals: { search: true, aiInput: true, aiTrain: false },
    } } });
    expect(c.discovery.robots).toMatchObject({
      policy: 'retrieval-only',
      universalAllow: true,
      allow: ['Claude-User'],
      disallow: ['GPTBot'],
      contentSignals: { search: true, aiInput: true, aiTrain: false },
    });
    expect(() => resolveConfig({ discovery: { robots: {
      policy: 'open', universalAllow: true,
    } } })).toThrow(/universalAllow/);
    expect(() => resolveConfig({ discovery: { robots: {
      policy: 'closed', allow: ['GPTBot'], disallow: ['gptbot'],
    } } })).toThrow(/overlap/);
    expect(() => resolveConfig({ discovery: { robots: {
      policy: 'open', allow: ['bad\ntoken'],
    } } })).toThrow(/user-agent tokens/);
    expect(() => resolveConfig({ discovery: { robots: {
      contentSignals: /** @type {any} */ ({ search: true, aiInput: false }),
    } } })).toThrow(/aiTrain/);
  });

  test('normalizes safe IndexNow descriptors without resolving secrets', () => {
    const c = resolveConfig({ discovery: { indexNow: {
      enabled: true,
      submit: 'all',
      state: 'private',
      strict: true,
      key: { source: 'file', path: '/run/secrets/indexnow' },
      keyLocation: '/keys/indexnow.txt',
      origins: [
        { origin: 'https://EXAMPLE.com/', key: { source: 'env', name: 'EXAMPLE_INDEXNOW' } },
        { origin: 'https://docs.example.com', keyLocation: '/indexnow.txt' },
      ],
    } } });

    expect(c.discovery.indexNow).toEqual({
      enabled: true,
      submit: 'all',
      state: 'private',
      strict: true,
      key: { source: 'file', path: '/run/secrets/indexnow' },
      keyLocation: '/keys/indexnow.txt',
      origins: [
        { origin: 'https://example.com', key: { source: 'env', name: 'EXAMPLE_INDEXNOW' } },
        { origin: 'https://docs.example.com', keyLocation: '/indexnow.txt' },
      ],
    });
  });

  test('forces stateless IndexNow preparation to all and validates unsafe descriptors', () => {
    const warnings = [];
    const c = resolveConfig(
      { discovery: { indexNow: { state: 'stateless', submit: 'changed' } } },
      { warn: (message) => warnings.push(message) },
    );
    expect(c.discovery.indexNow.submit).toBe('all');
    expect(warnings.join('\n')).toContain('stateless');

    expect(() => resolveConfig({ discovery: { indexNow: {
      key: /** @type {any} */ ({ source: 'env', name: 'NOT VALID' }),
    } } })).toThrow(/environment variable/);
    expect(() => resolveConfig({ discovery: { indexNow: {
      key: /** @type {any} */ ({ source: 'env', name: 'INDEXNOW_KEY', value: 'literal-secret' }),
    } } })).toThrow(/value is not supported/);
    expect(() => resolveConfig({ discovery: { indexNow: {
      key: /** @type {any} */ ({ source: 'file' }),
    } } })).toThrow(/non-empty local file/);
    expect(() => resolveConfig({ discovery: { indexNow: { keyLocation: '/key.txt?secret=yes' } } }))
      .toThrow(/keyLocation/);
    expect(() => resolveConfig({ discovery: { indexNow: {
      origins: [{ origin: 'http://example.com' }],
    } } })).toThrow(/HTTPS/);
    expect(() => resolveConfig({ discovery: { indexNow: {
      origins: [{ origin: 'https://example.com' }, { origin: 'https://EXAMPLE.com/' }],
    } } })).toThrow(/duplicate origin/);
    // A single trailing dot is the fully qualified spelling of the same name.
    for (const localOrigin of [
      'https://localhost', 'https://app.localhost', 'https://127.0.0.1', 'https://[::1]',
      'https://192.168.0.10', 'https://localhost.', 'https://app.localhost.',
    ]) {
      expect(() => resolveConfig({ discovery: { indexNow: {
        origins: [{ origin: localOrigin }],
      } } }), localOrigin).toThrow(/public/);
    }
    expect(resolveConfig({ discovery: { indexNow: {
      origins: [{ origin: 'https://example.com.' }],
    } } }).discovery.indexNow.origins[0].origin).toBe('https://example.com.');
  });

  test('page catalog descriptors require a non-empty module', () => {
    expect(resolveConfig({ pages: { catalogs: [{ module: './catalog.js' }] } }).pages.catalogs)
      .toEqual([{ module: './catalog.js' }]);
    expect(() => resolveConfig({ pages: { catalogs: [{}] } })).toThrow(/pages\.catalogs\[0\]\.module/);
    expect(() => resolveConfig({ pages: { catalogs: [{ module: '  ' }] } })).toThrow(AeoConfigError);
    expect(() => resolveConfig({ pages: { catalogs: /** @type {any} */ ({}) } })).toThrow(AeoConfigError);
    expect(resolveConfig({ pages: { catalogs: [{ module: './cms.js', revalidate: 10 }] } }).pages.catalogs)
      .toEqual([{ module: './cms.js', revalidate: 10 }]);
    expect(resolveConfig({ pages: { catalogs: [{ module: './cms.js', revalidate: false }] } }).pages.catalogs[0].revalidate)
      .toBe(false);
    for (const revalidate of [-1, Number.NaN, Infinity, '10', true]) {
      expect(() => resolveConfig({ pages: { catalogs: [{ module: './cms.js', revalidate: /** @type {any} */ (revalidate) }] } }))
        .toThrow(/pages\.catalogs\[0\]\.revalidate/);
    }
  });

  test('resolves and validates development dynamic-route discovery', () => {
    /** @type {string[]} */
    const warnings = [];
    for (const mode of /** @type {const} */ (['startup', 'hot', false])) {
      expect(resolveConfig(
        { pages: { devDynamicDiscovery: mode } },
        { warn: (message) => warnings.push(message) },
      ).pages.devDynamicDiscovery).toBe(mode);
    }
    expect(warnings).toEqual([]);
    expect(() => resolveConfig({
      pages: { devDynamicDiscovery: /** @type {any} */ ('reload') },
    })).toThrow(/pages\.devDynamicDiscovery/);
  });

  test('extraction selector properties must be arrays when supplied', () => {
    for (const key of ['selectors', 'removeSelectors', 'keepSelectors']) {
      expect(() => resolveConfig({ markdown: { extraction: { [key]: 'main' } } })).toThrow(
        new RegExp(`markdown\\.extraction\\.${key} must be an array`),
      );
    }
    expect(resolveConfig({ markdown: { extraction: { selectors: [], removeSelectors: [], keepSelectors: [] } } }))
      .toMatchObject({ markdown: { extraction: { selectors: [], removeSelectors: [], keepSelectors: [] } } });
  });

  test('1.0 keys are a build-stopping error that names the canonical path', () => {
    // The table-wide rejection lives in lib/config-removed.test.js; these are the
    // spellings that 1.x documented most prominently.
    for (const [legacy, path] of [
      [{ dotmd: { dotmdMetadata: true } }, 'dotmd.dotmdMetadata -> markdown.frontmatter'],
      [{ domainProfile: { contact: 'hi@x.com' } }, 'domainProfile.contact -> site.profile.email'],
      [{ llmsTxt: { showLastmod: true } }, 'llmsTxt.showLastmod -> corpus.index.showLastModified'],
      [{ robotsTxt: { universalAllow: false } }, 'robotsTxt.universalAllow -> discovery.robots.universalAllow'],
      [{ stripTitleSuffix: /x$/ }, 'stripTitleSuffix -> pages.stripTitleSuffix'],
      [{ sitemapAlias: { outputFilename: 'map.xml' } }, 'sitemapAlias.outputFilename -> discovery.sitemap.alias.outputFilename'],
    ]) {
      expect(() => resolveConfig(legacy), path).toThrow(AeoConfigError);
      expect(() => resolveConfig(legacy)).toThrow(path);
    }
  });

  test('a 1.0 key is rejected even when the canonical key agrees with it', () => {
    expect(() =>
      resolveConfig({ stripTitleSuffix: /x$/i, pages: { stripTitleSuffix: /x$/i } }),
    ).toThrow('stripTitleSuffix -> pages.stripTitleSuffix');
  });

  test('a 1.0 block with only typos inside is still rejected, not ignored', () => {
    expect(() => resolveConfig({ robotsTxt: { sitemaPath: '/x' } })).toThrow('robotsTxt -> discovery.robots');
    expect(() => resolveConfig({ sitemap: { enable: true } })).toThrow('sitemap -> discovery.sitemap');
  });

  test('removed keys throw even with no logger', () => {
    expect(() => resolveConfig({ domainProfile: { entityType: 'Person' } })).toThrow(AeoConfigError);
  });

  test('unknown keys warn', () => {
    const warnings = [];
    resolveConfig({ nope: 1 }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  test('discovery.robots.universalAllow defaults to true and is overridable', () => {
    expect(resolveConfig().discovery.robots.universalAllow).toBe(true);
    expect(resolveConfig({ discovery: { robots: { universalAllow: false } } }).discovery.robots.universalAllow).toBe(false);
  });

  test('site.profile.email resolves', () => {
    expect(resolveConfig({ site: { profile: { email: 'hi@x.com' } } }).site.profile.email).toBe('hi@x.com');
  });

  test('nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ discovery: { robots: { sitemaPath: '/x' } } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('discovery.robots.sitemaPath'))).toBe(true);
  });

  test('sitemap nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ discovery: { sitemap: { mod: 'auto' } } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('discovery.sitemap.mod'))).toBe(true);
  });

  test('discovery.sitemap.alias.sourceFilename derives from the sitemap filenameBase', () => {
    expect(resolveConfig({ discovery: { sitemap: { options: { filenameBase: 'sm' } } } }).discovery.sitemap.alias.sourceFilename).toBe('sm-index.xml');
    // an explicit sourceFilename wins over the derived default
    expect(resolveConfig({ discovery: { sitemap: { alias: { sourceFilename: 'custom.xml' } } } }).discovery.sitemap.alias.sourceFilename).toBe('custom.xml');
  });

  test('discovery.robots.sitemapPath tracks the sitemap filenameBase so robots.txt points at a real file', () => {
    // A custom filenameBase makes @astrojs/sitemap write `${base}-index.xml`, so the
    // robots.txt Sitemap line must follow suit instead of the hard-coded default.
    expect(resolveConfig({ discovery: { sitemap: { options: { filenameBase: 'sm' } } } }).discovery.robots.sitemapPath).toBe('/sm-index.xml');
    // an explicit sitemapPath wins over the derived default
    expect(
      resolveConfig({ discovery: { sitemap: { options: { filenameBase: 'sm' } }, robots: { sitemapPath: '/x.xml' } } })
        .discovery.robots.sitemapPath,
    ).toBe('/x.xml');
  });

  test('sitemap alias nested typos warn with a dotted path', () => {
    const warnings = [];
    resolveConfig({ discovery: { sitemap: { alias: { enabld: true } } } }, { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('discovery.sitemap.alias.enabld'))).toBe(true);
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

  test('a RegExp survives resolution by reference', () => {
    const re = /\s*\|\s*Demo$/;
    expect(resolveConfig({ pages: { stripTitleSuffix: re } }).pages.stripTitleSuffix).toBe(re);
  });

  test('an explicit undefined resolves exactly like an omitted key', () => {
    expect(resolveConfig({ pages: { include: undefined }, markdown: undefined })).toEqual(resolveConfig());
  });

  test('an unknown top-level key is not descended into', () => {
    const warnings = [];
    resolveConfig({ nope: { alsoNope: true } }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual(['astro-aeo: unknown config key "nope" (ignored)']);
  });

  test('a valid canonical config produces no warnings at all', () => {
    const warnings = [];
    resolveConfig(
      {
        site: { profile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' } },
        markdown: { frontmatter: true },
        corpus: {
          small: { enabled: true, maxTokens: 10_000 },
          chunks: { enabled: true, maxTokensPerFile: 50_000, by: 'section' },
          manifest: { enabled: true },
          tokenizer: { module: './tokenizer.js', options: { model: 'example' } },
          compression: { gzip: true },
        },
        i18n: { indexes: 'both', unresolvedLanguage: 'default' },
        cache: { enabled: true },
        discovery: {
          robots: {
            enabled: true,
            policy: 'open',
            allow: ['Googlebot'],
            contentSignals: { search: true, aiInput: true, aiTrain: false },
          },
          indexNow: {
            enabled: true,
            key: { source: 'env', name: 'INDEXNOW_KEY' },
            origins: [{ origin: 'https://example.com', keyLocation: '/indexnow.txt' }],
          },
        },
      },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
  });
});

describe('robots sitemap tri-state', () => {
  // Omitted, true, and false are three distinct states, and the omitted one is the
  // default. Collapsing it to a boolean anywhere silently changes whether the
  // robots.txt Sitemap line is verified against the build output.
  const policy = (cfg) => resolveConfig(cfg).discovery.robots.sitemapPolicy;

  test('absent is auto', () => {
    expect(policy({})).toBe('auto');
    expect(policy({ discovery: { robots: {} } })).toBe('auto');
    // An explicit undefined must behave exactly like an omitted key.
    expect(policy({ discovery: { robots: { includeSitemap: undefined } } })).toBe('auto');
  });

  test('an explicit value resolves', () => {
    expect(policy({ discovery: { robots: { includeSitemap: true } } })).toBe('always');
    expect(policy({ discovery: { robots: { includeSitemap: false } } })).toBe('never');
  });

  test('includeSitemap stays equivalent to the old `?? true` boolean', () => {
    expect(resolveConfig({}).discovery.robots.includeSitemap).toBe(true);
    expect(resolveConfig({ discovery: { robots: { includeSitemap: true } } }).discovery.robots.includeSitemap).toBe(true);
    expect(resolveConfig({ discovery: { robots: { includeSitemap: false } } }).discovery.robots.includeSitemap).toBe(false);
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

  test('the removed 1.0 boolean names the mode it maps to', () => {
    // `enabled: false` never meant "no sitemap", only "do not auto-register", so it
    // maps to 'external' rather than 'disabled'.
    expect(() => resolveConfig({ sitemap: { enabled: false } })).toThrow(
      'sitemap.enabled -> discovery.sitemap.mode (false becomes "external")',
    );
    expect(() => resolveConfig({ sitemap: { enabled: true } })).toThrow('(true becomes "auto")');
  });
});

describe('resolveSiteMeta fallback chain', () => {
  test('site.name wins', () => {
    const c = resolveConfig({ site: { name: 'A', profile: { name: 'B' } } });
    expect(resolveSiteMeta(c, 'https://x.com', 'Title').name).toBe('A');
  });

  test('falls back to the profile then title then hostname', () => {
    expect(resolveSiteMeta(resolveConfig({ site: { profile: { name: 'B' } } }), 'https://x.com', 'T').name).toBe('B');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', 'T').name).toBe('T');
    expect(resolveSiteMeta(resolveConfig(), 'https://x.com', '').name).toBe('x.com');
  });
});
