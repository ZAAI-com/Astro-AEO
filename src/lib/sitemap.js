// @ts-check

/**
 * Decide what astro-aeo should do about a sitemap, given whether the feature is
 * enabled, whether the user already registered `@astrojs/sitemap` themselves,
 * and whether Astro's `site` is set.
 *
 * astro-aeo defers to the official `@astrojs/sitemap` integration rather than
 * emitting XML itself. When the feature is on and no sitemap is present, it
 * auto-registers one (which requires `site`). The resulting `active` flag gates
 * the robots.txt `Sitemap:` line so it never points at a file that was not
 * produced.
 *
 * @param {object} input
 * @param {boolean} input.enabled          `config.sitemap.enabled`.
 * @param {boolean} input.hasUserSitemap   User already added `@astrojs/sitemap`.
 * @param {boolean} input.hasSite          Astro `site` is configured.
 * @returns {{ register: boolean; active: boolean; warning?: string }}
 *   `register`: astro-aeo should add `@astrojs/sitemap`.
 *   `active`: a sitemap will exist in the build (gates robots.txt).
 *   `warning`: a one-time message to log, when the intent cannot be honored.
 */
export function resolveSitemapPlan({ enabled, hasUserSitemap, hasSite }) {
  if (!enabled) return { register: false, active: false };

  // Respect a user-registered sitemap; never double-register.
  if (hasUserSitemap) return { register: false, active: true };

  // Auto-registering @astrojs/sitemap requires a `site` URL; without it the
  // integration would emit nothing, so we stay inactive and explain why.
  if (!hasSite) {
    return {
      register: false,
      active: false,
      warning:
        'astro-aeo: sitemap is enabled but Astro `site` is not set, so no sitemap can be generated (the robots.txt Sitemap line is omitted). Set `site` in astro.config or add `@astrojs/sitemap` yourself.',
    };
  }

  return { register: true, active: true };
}
