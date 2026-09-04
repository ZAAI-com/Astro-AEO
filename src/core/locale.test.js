import { describe, expect, test } from 'vitest';
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
