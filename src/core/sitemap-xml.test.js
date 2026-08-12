import { describe, expect, test } from 'vitest';
import { parseSitemapXml } from './sitemap-xml.js';

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

describe('parseSitemapXml', () => {
  test('parses a strict URL set and canonicalizes hreflang tags', () => {
    const parsed = parseSitemapXml(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${NS}" xmlns:xhtml="http://www.w3.org/1999/xhtml">` +
        '<url><loc>https://example.test/en/?a=1&amp;b=2</loc>' +
        '<xhtml:link rel="alternate" hreflang="en_us" href="https://example.test/en/"/></url></urlset>',
    );

    expect(parsed.findings).toEqual([]);
    expect(parsed).toMatchObject({
      kind: 'urlset',
      urls: [{
        loc: 'https://example.test/en/?a=1&b=2',
        alternates: [{ language: 'en-US', url: 'https://example.test/en/' }],
      }],
    });
  });

  test('rejects mismatched tags, DTDs, bare ampersands, and repaired-looking XML', () => {
    for (const xml of [
      `<urlset xmlns="${NS}"><url></urlset>`,
      `<!DOCTYPE urlset [<!ENTITY x "secret">]><urlset xmlns="${NS}"/>`,
      `<urlset xmlns="${NS}"><url><loc>https://example.test/?a=1&b=2</loc></url></urlset>`,
      `<urlset xmlns="${NS}"><url><loc>https://example.test/</url></loc></urlset>`,
    ]) {
      expect(parseSitemapXml(xml).findings.map((entry) => entry.code)).toContain('sitemap-xml-malformed');
    }
  });

  test('requires the sitemap namespace and one loc per entry', () => {
    const parsed = parseSitemapXml('<urlset><url><lastmod>2026-01-01</lastmod></url></urlset>');
    expect(parsed.findings.map((entry) => entry.code)).toEqual([
      'sitemap-namespace-invalid',
      'sitemap-urlset-empty',
    ]);
  });

  test('reads sitemap indexes and rejects duplicate hreflang languages', () => {
    const index = parseSitemapXml(
      `<sitemapindex xmlns="${NS}"><sitemap><loc>https://example.test/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    );
    expect(index).toMatchObject({ kind: 'index', locations: ['https://example.test/sitemap-0.xml'], findings: [] });

    const urlset = parseSitemapXml(
      `<urlset xmlns="${NS}" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url>` +
        '<loc>https://example.test/</loc>' +
        '<xhtml:link rel="alternate" hreflang="en" href="https://example.test/en/"/>' +
        '<xhtml:link rel="alternate" hreflang="EN" href="https://example.test/other/"/>' +
        '</url></urlset>',
    );
    expect(urlset.findings.map((entry) => entry.code)).toContain('sitemap-hreflang-duplicate');
  });
});
