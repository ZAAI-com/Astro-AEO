import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HREFLANG_URL_CONTRACT } from '../../test/contracts/hreflang-url.js';
import { validateLocalSitemap } from './sitemap-validate.js';

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XHTML = 'http://www.w3.org/1999/xhtml';
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture({ canonicals = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-sitemap-validation-'));
  roots.push(root);
  mkdirSync(join(root, 'en'), { recursive: true });
  mkdirSync(join(root, 'fr'), { recursive: true });
  writeFileSync(join(root, 'en', 'index.html'), canonicals ? '<link rel="canonical" href="https://example.test/en/">' : '');
  writeFileSync(join(root, 'fr', 'index.html'), canonicals ? '<link rel="canonical" href="https://example.test/fr/">' : '');
  return root;
}

describe('validateLocalSitemap', () => {
  test('checks x-default agreement without fetching external default targets', () => {
    const root = fixture();
    const render = (frDefault) => `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
      '<url><loc>https://example.test/en/</loc><xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/>' +
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://choose.test/"/></url>' +
      '<url><loc>https://example.test/fr/</loc><xhtml:link rel="alternate" hreflang="en" href="https://example.test/en/"/>' +
      `<xhtml:link rel="alternate" hreflang="x-default" href="${frDefault}"/></url></urlset>`;
    const check = (target) => {
      writeFileSync(join(root, 'sitemap.xml'), render(target));
      return validateLocalSitemap({ distDir: root, entryPath: '/sitemap.xml', siteUrl: 'https://example.test' });
    };
    expect(check('https://other-choice.test/').findings).toContainEqual(expect.objectContaining({
      code: 'sitemap-hreflang-x-default-conflict', sourcePath: '/sitemap.xml',
    }));
    expect(check('https://choose.test/').valid).toBe(true);
  });

  test('follows confined shards and validates reciprocal alternates', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'sitemap-index.xml'),
      `<sitemapindex xmlns="${NS}"><sitemap><loc>https://example.test/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    );
    writeFileSync(
      join(root, 'sitemap-0.xml'),
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
        '<url><loc>https://example.test/en/</loc><xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/></url>' +
        '<url><loc>https://example.test/fr/</loc><xhtml:link rel="alternate" hreflang="en" href="https://example.test/en/"/></url>' +
        '</urlset>',
    );

    const result = validateLocalSitemap({
      distDir: root,
      entryPath: '/sitemap-index.xml',
      siteUrl: 'https://example.test',
    });

    expect(result.valid).toBe(true);
    expect(result.documentsChecked).toBe(2);
    expect(result.urls).toEqual(['https://example.test/en/', 'https://example.test/fr/']);
  });

  test('rejects external, escaping, missing, duplicate, and symlink shard references', () => {
    const root = fixture();
    const outside = join(root, '..', `outside-${Date.now()}.xml`);
    writeFileSync(outside, `<urlset xmlns="${NS}"><url><loc>https://example.test/en/</loc></url></urlset>`);
    roots.push(outside);
    symlinkSync(outside, join(root, 'linked.xml'));
    writeFileSync(
      join(root, 'sitemap-index.xml'),
      `<sitemapindex xmlns="${NS}">` +
        '<sitemap><loc>https://other.test/shard.xml</loc></sitemap>' +
        '<sitemap><loc>https://example.test/missing.xml</loc></sitemap>' +
        '<sitemap><loc>https://example.test/linked.xml</loc></sitemap>' +
        '<sitemap><loc>https://example.test/linked.xml</loc></sitemap>' +
        '</sitemapindex>',
    );

    const result = validateLocalSitemap({ distDir: root, entryPath: '/sitemap-index.xml', siteUrl: 'https://example.test' });
    const codes = result.findings.map((entry) => entry.code);
    expect(result.valid).toBe(false);
    expect(codes).toContain('sitemap-reference-not-local');
    expect(codes).toContain('sitemap-reference-missing');
    expect(codes).toContain('sitemap-reference-duplicate');
  });

  test('reports duplicates, canonical mismatches, unresolved routes, and reciprocity', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'sitemap.xml'),
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
        '<url><loc>https://example.test/en/</loc><xhtml:link rel="alternate" hreflang="fr" href="https://example.test/fr/"/></url>' +
        '<url><loc>https://example.test/en/</loc></url>' +
        '<url><loc>https://example.test/unknown/</loc></url>' +
        '</urlset>',
    );

    const result = validateLocalSitemap({ distDir: root, entryPath: '/sitemap.xml', siteUrl: 'https://example.test' });
    const codes = result.findings.map((entry) => entry.code);
    expect(codes).toContain('sitemap-url-duplicate');
    expect(codes).toContain('sitemap-route-missing');
    expect(codes).toContain('sitemap-hreflang-not-reciprocal');
  });

  test('does not fetch or follow an external sitemap location', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'sitemap-index.xml'),
      `<sitemapindex xmlns="${NS}"><sitemap><loc>https://external.invalid/sitemap.xml</loc></sitemap></sitemapindex>`,
    );
    const result = validateLocalSitemap({ distDir: root, entryPath: '/sitemap-index.xml', siteUrl: 'https://example.test' });
    expect(result.documentsChecked).toBe(1);
    expect(result.findings.map((entry) => entry.code)).toContain('sitemap-reference-not-local');
  });

  test('allows query-bearing sitemap URLs and treats distinct queries as separate routes', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'sitemap.xml'),
      `<urlset xmlns="${NS}">` +
        '<url><loc>https://example.test/en/?page=1</loc></url>' +
        '<url><loc>https://example.test/en/?page=2</loc></url>' +
        '</urlset>',
    );

    const result = validateLocalSitemap({
      distDir: root,
      entryPath: '/sitemap.xml',
      siteUrl: 'https://example.test',
      runtimeUrls: [
        'https://example.test/en/?page=1',
        'https://example.test/en/?page=2',
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.urls).toEqual([
      'https://example.test/en/?page=1',
      'https://example.test/en/?page=2',
    ]);
    expect(result.findings.map((entry) => entry.code)).not.toContain('sitemap-url-invalid');
    expect(result.findings.map((entry) => entry.code)).not.toContain('sitemap-url-alias');
  });

  // The build normalizer in src/core/locale.js is held to the same table.
  test.each(HREFLANG_URL_CONTRACT)('hreflang URL: $name', ({ context, url, allowed }) => {
    const root = fixture({ canonicals: false });
    writeFileSync(
      join(root, 'sitemap.xml'),
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
        `<url><loc>${context}/en/</loc><xhtml:link rel="alternate" hreflang="fr" href="${url}"/></url>` +
        '</urlset>',
    );

    const result = validateLocalSitemap({ distDir: root, entryPath: '/sitemap.xml', siteUrl: context });
    expect(result.findings.map((entry) => entry.code).includes('sitemap-hreflang-url-invalid')).toBe(!allowed);
  });

  test('validates a sitemap built for a local development origin', () => {
    const root = fixture({ canonicals: false });
    writeFileSync(
      join(root, 'sitemap.xml'),
      `<urlset xmlns="${NS}" xmlns:xhtml="${XHTML}">` +
        '<url><loc>http://localhost:4321/en/</loc><xhtml:link rel="alternate" hreflang="fr" href="http://localhost:4321/fr/"/></url>' +
        '<url><loc>http://localhost:4321/fr/</loc><xhtml:link rel="alternate" hreflang="en" href="http://localhost:4321/en/"/></url>' +
        '</urlset>',
    );

    const result = validateLocalSitemap({ distDir: root, entryPath: '/sitemap.xml', siteUrl: 'http://localhost:4321' });
    expect(result.findings).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
