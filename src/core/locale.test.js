import { describe, expect, test } from 'vitest';
import { HREFLANG_URL_CONTRACT } from '../../test/contracts/hreflang-url.js';
import { createLocaleSnapshot, normalizePageAlternates, resolvePageLocale } from './locale.js';

function page(pathname, alternates = [], rendered = '') {
  const canonicalUrl = `https://example.test${pathname}`;
  return {
    id: pathname,
    pathname,
    canonicalUrl,
    url: canonicalUrl,
    alternates,
    representations: {
      html: `<html><head>${rendered}</head><body></body></html>`,
    },
  };
}

function withoutCanonical(record) {
  const { canonicalUrl: _canonicalUrl, ...rest } = record;
  return rest;
}

/** A page served from `context`. Loopback pages carry no canonical, as in a real build. */
function servedAt(context, alternates = [], rendered = '') {
  const url = `${context}/en/`;
  const record = { ...withoutCanonical(page('/en/', alternates, rendered)), url };
  return context.startsWith('https:') ? { ...record, canonicalUrl: url } : record;
}

describe('hreflang normalization', () => {
  test('keeps a structured language target when unmanaged markup conflicts', () => {
    const result = normalizePageAlternates([
      page('/en/', [{ language: 'fr_fr', url: 'https://example.test/fr/' }],
        '<link rel="alternate" hreflang="fr-FR" href="https://example.test/wrong/">'),
    ]);

    expect(result.pages[0].alternates).toEqual([
      { language: 'fr-FR', url: 'https://example.test/fr/' },
    ]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-structured-precedence',
      severity: 'error',
    }));
  });

  test('requires reciprocity for known same-origin pages', () => {
    const result = normalizePageAlternates([
      page('/en/', [{ language: 'fr', url: 'https://example.test/fr/' }]),
      page('/fr/'),
    ]);

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-not-reciprocal',
      pathname: '/en/',
    }));
  });

  test('does not require reciprocity from safe external HTTPS targets', () => {
    const result = normalizePageAlternates([
      page('/en/', [{ language: 'fr', url: 'https://fr.example.test/fr/' }]),
      {
        ...page('/fr/'),
        canonicalUrl: 'https://fr.example.test/fr/',
        url: 'https://fr.example.test/fr/',
      },
    ]);

    expect(result.diagnostics.some(({ code }) => code === 'hreflang-not-reciprocal')).toBe(false);
  });

  test('reports a local hreflang target that is not the page canonical', () => {
    const result = normalizePageAlternates([
      page('/en/', [{ language: 'fr', url: 'https://example.test/fr' }]),
      { ...page('/fr/'), url: 'https://example.test/fr' },
    ]);

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-canonical-conflict',
      pathname: '/en/',
    }));
  });

  test('checks a page that declares no canonical URL through its served URL', () => {
    const result = normalizePageAlternates([
      withoutCanonical(page('/en/', [{ language: 'fr', url: 'https://example.test/fr/' }])),
      page('/fr/'),
    ]);

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-not-reciprocal',
      pathname: '/en/',
    }));
    expect(result.diagnostics.some(({ code }) => code === 'hreflang-canonical-conflict'))
      .toBe(false);
  });

  // Regression guard: absence of a canonical is not evidence of disagreement.
  test('never flags a canonical-less target as non-canonical', () => {
    const result = normalizePageAlternates([
      withoutCanonical(page('/en/', [{ language: 'fr', url: 'https://example.test/fr/' }])),
      withoutCanonical(page('/fr/', [{ language: 'en', url: 'https://example.test/en/' }])),
    ]);

    expect(result.diagnostics).toEqual([]);
  });

  // Regression guard: an external https alternate on an http development page
  // matches no local target, so both checks stay silent exactly as they did
  // before canonical-less pages were brought into scope.
  test('leaves http development pages alone', () => {
    const result = normalizePageAlternates([
      {
        ...withoutCanonical(page('/en/', [{ language: 'fr', url: 'https://example.test/fr/' }])),
        url: 'http://localhost:4321/en/',
      },
      { ...withoutCanonical(page('/fr/')), url: 'http://localhost:4321/fr/' },
    ]);

    expect(result.diagnostics).toEqual([]);
  });

  test('resolves rendered hreflang against the served URL, not the canonical', () => {
    const served = {
      ...page('/en/'),
      url: 'https://example.test/en/',
      canonicalUrl: 'https://www.example.test/en/',
      representations: {
        html: '<html><head><link rel="alternate" hreflang="fr" href="/fr/"></head><body></body></html>',
      },
    };
    const result = normalizePageAlternates([served]);

    expect(result.pages[0].alternates).toEqual([
      { language: 'fr', url: 'https://example.test/fr/' },
    ]);
  });

  // The sitemap validator is held to the same table.
  test.each(HREFLANG_URL_CONTRACT)('structured alternate: $name', ({ context, url, allowed }) => {
    const result = normalizePageAlternates([servedAt(context, [{ language: 'fr', url }])]);

    expect(result.diagnostics.map(({ code }) => code)).toEqual(allowed ? [] : ['hreflang-invalid']);
  });

  test.each(HREFLANG_URL_CONTRACT)('rendered alternate: $name', ({ context, url, allowed }) => {
    const result = normalizePageAlternates([
      servedAt(context, [], `<link rel="alternate" hreflang="fr" href="${url}">`),
    ]);

    expect(result.diagnostics.map(({ code }) => code)).toEqual(allowed ? [] : ['hreflang-invalid']);
  });

  test('accepts a localhost alternate on a public page only in local development', () => {
    const pages = [page('/en/', [{ language: 'fr', url: 'http://localhost:4321/fr/' }])];

    expect(normalizePageAlternates(pages).diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-invalid',
      pathname: '/en/',
    }));
    const local = normalizePageAlternates(pages, { localDevelopment: true });
    expect(local.diagnostics).toEqual([]);
    expect(local.pages[0].alternates).toEqual([{ language: 'fr', url: 'http://localhost:4321/fr/' }]);
  });

  test('keeps rejecting public http alternates in local development', () => {
    const result = normalizePageAlternates(
      [page('/en/', [{ language: 'fr', url: 'http://example.test/fr/' }])],
      { localDevelopment: true },
    );

    expect(result.diagnostics.map(({ code }) => code)).toEqual(['hreflang-invalid']);
  });

  test('checks reciprocity between pages served from a local development host', () => {
    const en = servedAt('http://localhost:4321', [{ language: 'fr', url: 'http://localhost:4321/fr/' }]);
    const fr = { ...withoutCanonical(page('/fr/')), url: 'http://localhost:4321/fr/' };

    expect(normalizePageAlternates([
      en,
      { ...fr, alternates: [{ language: 'en', url: 'http://localhost:4321/en/' }] },
    ]).diagnostics).toEqual([]);
    expect(normalizePageAlternates([en, fr]).diagnostics).toContainEqual(expect.objectContaining({
      code: 'hreflang-not-reciprocal',
      pathname: '/en/',
    }));
  });

  test('resolves relative rendered hreflang on a local development page', () => {
    const result = normalizePageAlternates([
      servedAt('http://localhost:4321', [], '<link rel="alternate" hreflang="fr" href="/fr/">'),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.pages[0].alternates).toEqual([{ language: 'fr', url: 'http://localhost:4321/fr/' }]);
  });
});

describe('resolvePageLocale', () => {
  const snapshot = createLocaleSnapshot({
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: true },
  });

  test('applies default-language fallback only when unresolvedLanguage is default', () => {
    const resolved = resolvePageLocale(
      { pathname: '/about', languageSources: {} },
      snapshot,
      { unresolvedLanguage: 'default' },
    );
    expect(resolved.excluded).toBe(false);
    expect(resolved.page.language).toBe('en');
  });

  test('excludes unresolved pages when unresolvedLanguage is exclude', () => {
    const resolved = resolvePageLocale(
      { pathname: '/about', languageSources: {} },
      snapshot,
      { unresolvedLanguage: 'exclude' },
    );
    expect(resolved.excluded).toBe(true);
    expect(resolved.diagnostics).toContainEqual(expect.objectContaining({
      code: 'page-language-unresolved',
      severity: 'warning',
    }));
  });

  test('errors on unresolved pages when unresolvedLanguage is error', () => {
    const resolved = resolvePageLocale(
      { pathname: '/about', languageSources: {} },
      snapshot,
      { unresolvedLanguage: 'error' },
    );
    expect(resolved.excluded).toBe(true);
    expect(resolved.diagnostics).toContainEqual(expect.objectContaining({
      code: 'page-language-unresolved',
      severity: 'error',
    }));
  });
});
