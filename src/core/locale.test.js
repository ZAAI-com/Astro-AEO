import { describe, expect, test } from 'vitest';
import { normalizePageAlternates } from './locale.js';

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
