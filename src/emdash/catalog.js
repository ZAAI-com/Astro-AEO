// @ts-check
import { defineCmsAdapter } from '../content.js';
import { listEmDashPages } from './inventory.js';

let warnedLocales = false;

/**
 * The page catalog `emdashAeo()` registers. It reads EmDash through
 * `virtual:astro-aeo/emdash`, a module `emdashAeo()` serves from the project's
 * own `emdash` install, so it shares EmDash's database connection (and on D1
 * its per-request binding) and never opens the database itself.
 *
 * The bridge exists only inside Vite. Astro-AEO's native build-time call cannot
 * load it and lists nothing, which is correct: an EmDash site renders on
 * demand, so its server owns the request-time inventory. Any other failure,
 * loading the bridge or reading through it, throws so the runtime warns and
 * retries it instead of caching an empty site.
 */
export default defineCmsAdapter({
  name: 'emdash',
  listPages: () =>
    // @ts-ignore: served by the emdashAeo() Vite plugin.
    listEmDashCatalogPages(() => import('virtual:astro-aeo/emdash')),
});

/**
 * @param {() => Promise<any>} importBridge
 * @returns {Promise<import('../page.js').PageDescriptor[]>}
 */
export async function listEmDashCatalogPages(importBridge) {
  /** @type {any} */
  let bridge;
  try {
    bridge = await importBridge();
  } catch (error) {
    // Node's own loader, outside Vite, rejects the virtual: scheme.
    if (/** @type {any} */ (error)?.code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME') return [];
    throw error;
  }
  const db = await bridge.getDb();
  const schema = bridge.createSchemaAccess(db);
  const content = bridge.createContentAccess(db);
  const i18n = bridge.isI18nEnabled() ? bridge.getI18nConfig() : null;
  if (i18n && !warnedLocales) {
    warnedLocales = true;
    console.warn(
      `astro-aeo: the EmDash catalog lists the default locale (${i18n.defaultLocale}) only; describe translated entries in your own catalog.`,
    );
  }
  return listEmDashPages(
    {
      listCollections: () => schema.listCollections(),
      listEntries: (collection, { cursor, limit, locale }) =>
        content.list(collection, {
          where: { status: 'published', ...(locale ? { locale } : {}) },
          limit,
          ...(cursor ? { cursor } : {}),
        }),
      getTerms: (taxonomy) => bridge.getTaxonomyTerms(taxonomy, i18n ? { locale: i18n.defaultLocale } : {}),
      i18n,
      warn: (message) => console.warn(message),
    },
    bridge.options,
  );
}
