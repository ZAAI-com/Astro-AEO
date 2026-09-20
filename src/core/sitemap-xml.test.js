import { describe, expect, test } from 'vitest';
import { parseSitemapXml } from './sitemap-xml.js';

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XHTML = 'http://www.w3.org/1999/xhtml';

describe('parseSitemapXml', () => {
  test('parses a strict URL set and canonicalizes hreflang tags', () => {
    const parsed = parseSitemapXml(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
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

  test('accepts xml-stylesheet processing instructions from xslURL', () => {
    const parsed = parseSitemapXml(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>` +
        `<urlset xmlns="${NS}"><url><loc>https://example.test/</loc></url></urlset>`,
    );
    expect(parsed.findings).toEqual([]);
    expect(parsed.kind).toBe('urlset');
    expect(parsed.urls).toEqual([{ loc: 'https://example.test/', alternates: [] }]);
  });

  test('rejects a late XML declaration and uppercase XML targets', () => {
    for (const xml of [
      `<!-- comment --><?xml version="1.0"?><urlset xmlns="${NS}"/>`,
      ` <?xml version="1.0"?><urlset xmlns="${NS}"/>`,
      `<?XML version="1.0"?><urlset xmlns="${NS}"/>`,
      `<?xml-stylesheet href="x.xsl"?><?xml version="1.0"?><urlset xmlns="${NS}"/>`,
    ]) {
      expect(parseSitemapXml(xml).findings.map((entry) => entry.code)).toContain('sitemap-xml-malformed');
    }
  });

  test('rejects comment content ending with a hyphen', () => {
    for (const xml of [
      `<?xml version="1.0"?><urlset xmlns="${NS}"><!--bad---><url><loc>https://example.test/</loc></url></urlset>`,
      `<?xml version="1.0"?><urlset xmlns="${NS}"><!-- -><url><loc>https://example.test/</loc></url></urlset>`,
    ]) {
      const parsed = parseSitemapXml(xml);
      expect(parsed.findings.map((entry) => entry.code), xml).toContain('sitemap-xml-malformed');
    }
    const accepted = parseSitemapXml(
      `<?xml version="1.0"?><urlset xmlns="${NS}"><!-- fine --><url><loc>https://example.test/</loc></url></urlset>`,
    );
    expect(accepted.findings).toEqual([]);
  });

  test('resolves per-element xmlns:xhtml declarations', () => {
    const parsed = parseSitemapXml(
      `<urlset xmlns="${NS}">` +
        `<url xmlns:xhtml="${XHTML}">` +
        '<loc>https://example.test/en/</loc>' +
        '<xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/>' +
        '</url></urlset>',
    );
    expect(parsed.findings).toEqual([]);
    expect(parsed.urls).toEqual([{
      loc: 'https://example.test/en/',
      alternates: [{ language: 'fr', url: 'https://example.test/fr/' }],
    }]);
  });

  test('rejects non-whitespace text in element-only containers', () => {
    const parsed = parseSitemapXml(
      `<urlset xmlns="${NS}">oops<url><loc>https://example.test/</loc></url></urlset>`,
    );
    expect(parsed.findings.map((entry) => entry.code)).toContain('sitemap-mixed-content');
  });

  test('rejects NBSP but accepts XML whitespace in element-only containers', () => {
    const nbsp = parseSitemapXml(
      `<urlset xmlns="${NS}"><url>&#160;<loc>https://example.test/</loc></url></urlset>`,
    );
    expect(nbsp.findings.map((entry) => entry.code)).toContain('sitemap-mixed-content');

    const whitespace = parseSitemapXml(
      `<urlset xmlns="${NS}"><url>\n \t<loc>https://example.test/</loc></url></urlset>`,
    );
    expect(whitespace.findings).toEqual([]);
  });

  test('rejects processing instructions with invalid XML target names', () => {
    for (const xml of [
      `<?bad/target href="x"?><urlset xmlns="${NS}"/>`,
      `<?1bad?><urlset xmlns="${NS}"/>`,
      `<?a:b:c?><urlset xmlns="${NS}"/>`,
    ]) {
      expect(parseSitemapXml(xml).findings.map((entry) => entry.code)).toContain('sitemap-xml-malformed');
    }
  });

  test('does not inherit per-element namespace declarations into siblings', () => {
    const parsed = parseSitemapXml(
      `<urlset xmlns="${NS}">` +
        `<url xmlns:xhtml="${XHTML}">` +
        '<loc>https://example.test/en/</loc>' +
        `<xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/>` +
        '</url>' +
        `<url><loc>https://example.test/plain/</loc>` +
        `<xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/>` +
        '</url></urlset>',
    );
    // The second <url> does not declare xmlns:xhtml, so its xhtml:link is an
    // unknown extension element rather than an alternate.
    expect(parsed.urls).toEqual([
      { loc: 'https://example.test/en/', alternates: [{ language: 'fr', url: 'https://example.test/fr/' }] },
      { loc: 'https://example.test/plain/', alternates: [] },
    ]);
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

  test('rejects a root element that is neither urlset nor sitemapindex', () => {
    const parsed = parseSitemapXml(`<feed xmlns="${NS}"><url><loc>https://example.test/</loc></url></feed>`);
    expect(parsed.findings.map((entry) => entry.code)).toEqual(['sitemap-root-invalid']);
    expect(parsed).toMatchObject({ kind: null, locations: [], urls: [] });
  });

  test.each([
    ['no loc at all', '<url><lastmod>2026-01-01</lastmod></url>'],
    ['two locs', '<url><loc>https://example.test/a</loc><loc>https://example.test/b</loc></url>'],
    ['an empty loc', '<url><loc>   </loc></url>'],
    ['a loc with element children', '<url><loc><a>https://example.test/</a></loc></url>'],
  ])('rejects a <url> entry with %s', (_label, entry) => {
    const parsed = parseSitemapXml(`<urlset xmlns="${NS}">${entry}</urlset>`);
    expect(parsed.findings.map((finding) => finding.code)).toContain('sitemap-url-loc-invalid');
    // Diagnosing the entry is not enough: it must also be excluded from the
    // URL set, or a caller that only reads `urls` still trusts it.
    expect(parsed.urls).toEqual([]);
    expect(parsed.findings.map((finding) => finding.code)).toContain('sitemap-urlset-empty');
  });

  test.each([
    ['no loc at all', '<sitemap><lastmod>2026-01-01</lastmod></sitemap>'],
    ['two locs', '<sitemap><loc>https://example.test/a.xml</loc><loc>https://example.test/b.xml</loc></sitemap>'],
    ['an empty loc', '<sitemap><loc> </loc></sitemap>'],
  ])('rejects a <sitemap> entry with %s and reports the empty index', (_label, entry) => {
    const parsed = parseSitemapXml(`<sitemapindex xmlns="${NS}">${entry}</sitemapindex>`);
    expect(parsed.findings.map((finding) => finding.code)).toEqual([
      'sitemap-index-loc-invalid',
      'sitemap-index-empty',
    ]);
  });

  test('reports an index that carries no <sitemap> entries at all', () => {
    const parsed = parseSitemapXml(`<sitemapindex xmlns="${NS}"></sitemapindex>`);
    expect(parsed.findings.map((finding) => finding.code)).toEqual(['sitemap-index-empty']);
  });

  test.each([
    ['an unparseable hreflang', 'hreflang="not a tag" href="https://example.test/x/"'],
    ['a missing hreflang', 'href="https://example.test/x/"'],
    ['an empty href', 'hreflang="fr" href="  "'],
    ['a missing href', 'hreflang="fr"'],
  ])('rejects an xhtml:link alternate with %s', (_label, attrs) => {
    const parsed = parseSitemapXml(
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}"><url>` +
        '<loc>https://example.test/</loc>' +
        `<xhtml:link rel="alternate" ${attrs}/>` +
        '</url></urlset>',
    );
    expect(parsed.findings.map((finding) => finding.code)).toContain('sitemap-hreflang-invalid');
    expect(parsed.urls[0].alternates).toEqual([]);
  });

  test.each([
    ['an unclosed comment', `<urlset xmlns="${NS}"><!-- never closed <url><loc>https://example.test/</loc></url></urlset>`],
    ['a duplicate attribute', `<urlset xmlns="${NS}"><url a="1" a="2"><loc>https://example.test/</loc></url></urlset>`],
    ['an unescaped < in an attribute value', `<urlset xmlns="${NS}"><url a="1<2"><loc>https://example.test/</loc></url></urlset>`],
    ['multiple root elements', `<urlset xmlns="${NS}"/><urlset xmlns="${NS}"/>`],
  ])('rejects %s as malformed XML', (_label, xml) => {
    expect(parseSitemapXml(xml).findings.map((finding) => finding.code)).toContain('sitemap-xml-malformed');
  });

  test('reads sitemap indexes and rejects duplicate hreflang languages', () => {
    const index = parseSitemapXml(
      `<sitemapindex xmlns="${NS}"><sitemap><loc>https://example.test/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    );
    expect(index).toMatchObject({ kind: 'index', locations: ['https://example.test/sitemap-0.xml'], findings: [] });

    const urlset = parseSitemapXml(
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}"><url>` +
        '<loc>https://example.test/</loc>' +
        '<xhtml:link rel="alternate" hreflang="en" href="https://example.test/en/"/>' +
        '<xhtml:link rel="alternate" hreflang="EN" href="https://example.test/other/"/>' +
        '</url></urlset>',
    );
    expect(urlset.findings.map((entry) => entry.code)).toContain('sitemap-hreflang-duplicate');
  });
});
