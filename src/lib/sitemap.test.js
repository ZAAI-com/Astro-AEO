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
  test('auto with site and no user sitemap: auto-register and expect output', () => {
    const plan = resolveSitemapPlan({ mode: 'auto', hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: true, expected: true });
  });

  test('auto but user already has a sitemap: do not re-register, still expect output', () => {
    const plan = resolveSitemapPlan({ mode: 'auto', hasUserSitemap: true, hasSite: true });
    expect(plan).toEqual({ register: false, expected: true });
  });

  test('auto without site: no expected output, warning, or registration', () => {
    const plan = resolveSitemapPlan({ mode: 'auto', hasUserSitemap: false, hasSite: false });
    expect(plan.register).toBe(false);
    expect(plan.expected).toBe(false);
    expect(plan.warning).toMatch(/site/);
  });

  test('user sitemap wins even without an astro-aeo-known site', () => {
    // A user who registered @astrojs/sitemap owns the site requirement; we stay
    // out of the way and let the finalizer verify the expected output.
    const plan = resolveSitemapPlan({ mode: 'auto', hasUserSitemap: true, hasSite: false });
    expect(plan).toEqual({ register: false, expected: true });
  });

  test('external: never auto-register, and expect nothing without a user sitemap', () => {
    const plan = resolveSitemapPlan({ mode: 'external', hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: false, expected: false });
  });

  test('external with a user sitemap remains expected (no double-register)', () => {
    // 'external' only turns off auto-registration. It must not hide a sitemap the
    // user registered: that stays expected, and the finalizer verifies the file
    // before advertising it. This is the meaning the 1.0 `sitemap.enabled: false`
    // always had, which is why it maps here rather than to 'disabled'.
    const plan = resolveSitemapPlan({ mode: 'external', hasUserSitemap: true, hasSite: true });
    expect(plan).toEqual({ register: false, expected: true });
  });

  test('disabled opts out even when the user registered a sitemap', () => {
    // The one state with no 1.0 equivalent: no auto-registration, no alias, and
    // no robots.txt Sitemap line, regardless of what else is present.
    expect(resolveSitemapPlan({ mode: 'disabled', hasUserSitemap: true, hasSite: true })).toEqual({
      register: false,
      expected: false,
    });
    expect(resolveSitemapPlan({ mode: 'disabled', hasUserSitemap: false, hasSite: false })).toEqual({
      register: false,
      expected: false,
    });
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
