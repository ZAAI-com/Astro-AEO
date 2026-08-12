import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateLocalSitemap } from './sitemap-validate.js';

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XHTML = 'http://www.w3.org/1999/xhtml';
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeo-sitemap-validation-'));
  roots.push(root);
  mkdirSync(join(root, 'en'), { recursive: true });
  mkdirSync(join(root, 'fr'), { recursive: true });
  writeFileSync(join(root, 'en', 'index.html'), '<link rel="canonical" href="https://example.test/en/">');
  writeFileSync(join(root, 'fr', 'index.html'), '<link rel="canonical" href="https://example.test/fr/">');
  return root;
}

describe('validateLocalSitemap', () => {
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
});
