// @ts-check

/**
 * Loading the page catalogs a project configured.
 *
 * Build-only, and deliberately not part of `astro-aeo/page`: that subpath is the
 * public surface a page imports, and it should stay `defineAeoPage` plus types.
 */

/**
 * Load the configured page catalogs.
 *
 * A catalog lists pages the build cannot see for itself, which is every route
 * generated from data rather than from a file. Without one, a dynamic route is
 * simply absent from the corpus; astro-aeo does not crawl to find them.
 *
 * @param {{ module: string }[]} catalogs
 * @param {(specifier: string) => Promise<any>} load
 * @param {{ warn: (m: string) => void }} logger
 * @returns {Promise<{ pathname: string; lastModified?: string }[]>}
 */
export async function loadCatalogPages(catalogs, load, logger) {
  /** @type {{ pathname: string; lastModified?: string }[]} */
  const pages = [];
  for (const catalog of catalogs) {
    try {
      const mod = await load(catalog.module);
      const impl = mod?.default ?? mod;
      if (typeof impl?.listPages !== 'function') {
        logger.warn(
          `astro-aeo: the page catalog "${catalog.module}" has no listPages() export, so it contributed nothing.`,
        );
        continue;
      }
      const listed = await impl.listPages();
      for (const entry of Array.isArray(listed) ? listed : []) {
        if (typeof entry?.pathname === 'string' && entry.pathname.startsWith('/')) {
          pages.push({ pathname: entry.pathname, lastModified: entry.lastModified });
        }
      }
    } catch (err) {
      // A broken catalog must not fail the build: the rest of the output is still
      // correct, and the pages it would have added are simply absent.
      logger.warn(
        `astro-aeo: the page catalog "${catalog.module}" failed to load, so it contributed nothing: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return pages;
}
