import { test, expect, describe } from 'vitest';
import { resolveSitemapPlan } from './sitemap.js';

describe('resolveSitemapPlan', () => {
  test('enabled with site and no user sitemap: auto-register and active', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: true, active: true });
  });

  test('enabled but user already has a sitemap: do not re-register, still active', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: true, hasSite: true });
    expect(plan).toEqual({ register: false, active: true });
  });

  test('enabled without site: inactive with a warning, no registration', () => {
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: false, hasSite: false });
    expect(plan.register).toBe(false);
    expect(plan.active).toBe(false);
    expect(plan.warning).toMatch(/site/);
  });

  test('user sitemap wins even without an astro-aeo-known site', () => {
    // A user who registered @astrojs/sitemap owns the site requirement; we stay
    // out of the way and treat the sitemap as active.
    const plan = resolveSitemapPlan({ enabled: true, hasUserSitemap: true, hasSite: false });
    expect(plan).toEqual({ register: false, active: true });
  });

  test('disabled: never register, never active, no warning', () => {
    const plan = resolveSitemapPlan({ enabled: false, hasUserSitemap: false, hasSite: true });
    expect(plan).toEqual({ register: false, active: false });
  });
});
