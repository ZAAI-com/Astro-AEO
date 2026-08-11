// @ts-check
import { configuredCanonical } from './canonical.js';
import { inspectRootPathname, normalizeCatalogPathname, normalizePath } from './match.js';

/**
 * Build a breadcrumb trail only from an explicitly enumerated catalog chain.
 * Every ancestor, including the root and current page, must have an authored
 * title and a canonical derived from the configured stable Astro site. URL
 * segments are never promoted into labels.
 *
 * @param {string} pathname
 * @param {readonly import('../page.js').PageDescriptor[]} descriptors
 * @param {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @returns {ReadonlyArray<{ name: string; item: string }> | null}
 */
export function catalogBreadcrumbTrail(pathname, descriptors, site) {
  const current = catalogPath(pathname);
  if (!current || current.key === '/') return null;

  /** @type {Map<string, { name: string; item: string }>} */
  const authored = new Map();
  for (const descriptor of descriptors) {
    const path = catalogPath(descriptor?.pathname);
    const name = typeof descriptor?.title === 'string' ? descriptor.title.trim() : '';
    if (!path || !name || authored.has(path.key)) continue;
    const item = configuredCanonical(site, path.urlPath);
    if (item) authored.set(path.key, { name, item });
  }

  const trail = [];
  for (const ancestor of pathAncestors(current.key)) {
    const entry = authored.get(ancestor);
    if (!entry) return null;
    trail.push({ ...entry });
  }
  return trail.length > 1 ? trail : null;
}

/** @param {unknown} value */
function catalogPath(value) {
  const urlPath = normalizeCatalogPathname(value);
  const inspected = inspectRootPathname(value);
  if (urlPath === null || inspected === null) return null;
  const key = normalizePath(inspected.decoded);
  if (key !== '/' && key.slice(1).split('/').some((segment) => !segment)) return null;
  return { key, urlPath };
}

/** @param {string} pathname */
function pathAncestors(pathname) {
  const ancestors = ['/'];
  let current = '';
  for (const segment of pathname.slice(1).split('/')) {
    current += `/${segment}`;
    ancestors.push(current);
  }
  return ancestors;
}
