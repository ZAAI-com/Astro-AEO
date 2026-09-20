// @ts-check

import { inspectRootPathname } from './match.js';

/**
 * Cross-domain catalog page identity. Build and runtime must use the same key
 * so the same descriptor cannot collide under one origin while surviving under
 * another.
 *
 * @param {string | null | undefined} origin
 * @param {string} pathname
 * @returns {string}
 */
export function pageCatalogIdentity(origin, pathname) {
  return `${origin ?? ''}\0${identityPathname(pathname)}`;
}

/**
 * Corpus planner / manifest page identity. Pages are keyed by their stable id
 * within an origin, not by the request pathname spelling.
 *
 * @param {{ origin?: string | null; id: string }} page
 * @returns {string}
 */
export function corpusPageIdentity(page) {
  return `${page.origin ?? ''}\0${page.id}`;
}

/**
 * Concrete Astro routes arrive decoded while a catalog may spell the same path
 * percent-encoded. The identity uses the once-decoded form so both spellings
 * of one page share a key and catalog overlays cannot miss or duplicate.
 *
 * @param {string} pathname
 * @returns {string}
 */
function identityPathname(pathname) {
  return inspectRootPathname(pathname)?.decoded ?? pathname;
}
