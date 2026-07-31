// @ts-check
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Decide what astro-aeo should do about a sitemap, given whether the feature is
 * enabled, whether the user already registered `@astrojs/sitemap` themselves,
 * and whether Astro's `site` is set.
 *
 * astro-aeo defers to the official `@astrojs/sitemap` integration rather than
 * emitting XML itself. When the feature is on and no sitemap is present, it
 * auto-registers one (which requires `site`). The resulting `expected` flag
 * records whether an official integration should produce a sitemap; the late
 * finalizer still verifies the file before advertising it.
 *
 * @param {object} input
 * @param {'auto'|'external'|'disabled'} input.mode  `config.discovery.sitemap.mode`.
 * @param {boolean} input.hasUserSitemap   User already added `@astrojs/sitemap`.
 * @param {boolean} input.hasSite          Astro `site` is configured.
 * @returns {{ register: boolean; expected: boolean; warning?: string }}
 *   `register`: astro-aeo should add `@astrojs/sitemap`.
 *   `expected`: an official sitemap integration should produce a sitemap.
 *   `warning`: a one-time message to log, when the intent cannot be honored.
 */
export function resolveSitemapPlan({ mode, hasUserSitemap, hasSite }) {
  // 'disabled' opts out of sitemap handling entirely, including a sitemap the
  // project registered itself. This state has no 1.0 equivalent.
  if (mode === 'disabled') return { register: false, expected: false };

  // Respect a user-registered sitemap; never double-register. It counts as
  // expected even in 'external' mode, which only turns off auto-registration.
  // The finalizer verifies its output before the robots.txt Sitemap line.
  if (hasUserSitemap) return { register: false, expected: true };

  if (mode === 'external') return { register: false, expected: false };

  // Auto-registering @astrojs/sitemap requires a `site` URL; without it the
  // integration would emit nothing, so no sitemap is expected.
  if (!hasSite) {
    return {
      register: false,
      expected: false,
      warning:
        'astro-aeo: sitemap is enabled but Astro `site` is not set, so no sitemap can be generated (the robots.txt Sitemap line is omitted). Set `site` in astro.config, or add a static sitemap to `public/`.',
    };
  }

  return { register: true, expected: true };
}

/**
 * Interpret the optional public robots setting without adding another config
 * key: omitted means automatic detection, true forces the line for runtime
 * sitemaps, and false suppresses it.
 *
 * @param {boolean | undefined} includeSitemap
 * @returns {'auto'|'always'|'never'}
 */
export function resolveSitemapPolicy(includeSitemap) {
  if (includeSitemap === true) return 'always';
  if (includeSitemap === false) return 'never';
  return 'auto';
}

/**
 * Resolve a root-relative sitemap URL path inside a filesystem root and report
 * whether it names a regular file. Invalid, external, and escaping paths are
 * treated as unavailable.
 *
 * @param {URL} rootDir
 * @param {string} sitemapPath
 * @returns {boolean}
 */
export function sitemapPathExists(rootDir, sitemapPath) {
  const relativePath = sitemapPathToRelative(sitemapPath);
  if (relativePath === null) return false;

  const root = fileURLToPath(rootDir);
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(root, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return false;
  }

  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether a configured sitemap path matches a concrete Astro route.
 *
 * @param {string} sitemapPath
 * @param {string[]} routes
 * @returns {boolean}
 */
export function sitemapPathMatchesRoute(sitemapPath, routes) {
  const relativePath = sitemapPathToRelative(sitemapPath);
  if (relativePath === null) return false;
  const routePath = normalizeRoute(`/${relativePath}`);
  return routes.some((route) => normalizeRoute(route) === routePath);
}

/**
 * @param {string} sitemapPath
 * @returns {string | null}
 */
function sitemapPathToRelative(sitemapPath) {
  if (typeof sitemapPath !== 'string' || !sitemapPath.startsWith('/')) return null;
  try {
    const parsed = new URL(sitemapPath, 'https://astro-aeo.invalid');
    if (parsed.origin !== 'https://astro-aeo.invalid') return null;
    const decoded = decodeURIComponent(parsed.pathname);
    const relativePath = decoded.replace(/^\/+/, '');
    return relativePath || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} route
 * @returns {string}
 */
function normalizeRoute(route) {
  let normalized = route.startsWith('/') ? route : `/${route}`;
  if (normalized.length > 1) normalized = normalized.replace(/\/$/, '');
  return normalized;
}
