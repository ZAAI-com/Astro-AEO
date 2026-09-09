// @ts-check

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
  return `${origin ?? ''}\0${pathname}`;
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
