import { test, expect, describe, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  resolveSitemapPlan,
  resolveSitemapPolicy,
  sitemapPathExists,
  sitemapPathMatchesRoute,
} from './sitemap.js';

describe('resolveSitemapPlan', () => {
  test('enabled with site and no user sitemap: auto-register and expect output', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: true, expected: true });
  });

  test('enabled but user already has a sitemap: do not re-register, still expect output', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: true, hasSite: true });
    expect(plan).toEqual({ register: false, expected: true });
  });

  test('enabled without site: no expected output, warning, or registration', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: false, hasSite: false });
    expect(plan.register).toBe(false);
    expect(plan.expected).toBe(false);
    expect(plan.warning).toMatch(/site/);
  });

  test('user sitemap wins even without an astro-aeo-known site', () => {
    // A user who registered @astrojs/sitemap owns the site requirement; we stay
    // out of the way and let the finalizer verify the expected output.
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: true, hasSite: false });
    expect(plan).toEqual({ register: false, expected: true });
  });

  test('disabled: never register or expect output, no warning', () => {
    const plan = resolveSitemapPlan({ enabled: false, hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: false, expected: false });
  });

  test('user sitemap with the feature disabled remains expected (no double-register)', () => {
    // Turning the feature off must not hide a sitemap the user registered: it is
    // still expected, but the finalizer verifies the file before advertising it.
    const plan = resolveSitemapPlan({ enabled: false, hasUserSitemap: true, hasSite: true });
    expect(plan).toEqual({ register: false, expected: true });
  });
});

describe('resolveSitemapPolicy', () => {
  test('omitted is auto, true is always, and false is never', () => {
    expect(resolveSitemapPolicy(undefined)).toBe('auto');
    expect(resolveSitemapPolicy(true)).toBe('always');
    expect(resolveSitemapPolicy(false)).toBe('never');
  });
});

describe('sitemap path detection', () => {
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'aeo-sitemap-path-'));
    dirs.push(dir);
    return { dir, url: pathToFileURL(`${dir}/`) };
  }

  test('finds regular files beneath the root', () => {
    const { dir, url } = fixture();
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'sitemap.xml'), '<xml>');
    expect(sitemapPathExists(url, '/nested/sitemap.xml')).toBe(true);
    expect(sitemapPathExists(url, '/missing.xml')).toBe(false);
    expect(sitemapPathExists(url, '/nested')).toBe(false);
  });

  test('rejects external, relative, malformed, and escaping paths', () => {
    const { url } = fixture();
    expect(sitemapPathExists(url, 'sitemap.xml')).toBe(false);
    expect(sitemapPathExists(url, 'https://example.com/sitemap.xml')).toBe(false);
    expect(sitemapPathExists(url, '/%2e%2e/secret.xml')).toBe(false);
    expect(sitemapPathExists(url, '/%E0%A4%A')).toBe(false);
  });

  test('matches normalized concrete Astro routes', () => {
    expect(sitemapPathMatchesRoute('/sitemap.xml', ['/about', '/sitemap.xml/'])).toBe(true);
    expect(sitemapPathMatchesRoute('/sitemap-index.xml', ['/sitemap.xml'])).toBe(false);
    expect(sitemapPathMatchesRoute('sitemap.xml', ['/sitemap.xml'])).toBe(false);
  });
});
