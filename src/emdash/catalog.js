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
 * demand, so its server owns the request-time inventory. Once the bridge has
 * loaded, a failed read throws so the runtime retries it on the next use.
 */
export default defineCmsAdapter({
  name: 'emdash',
  async listPages() {
    /** @type {any} */
    let bridge;
    try {
      // @ts-ignore: served by the emdashAeo() Vite plugin.
      bridge = await import('virtual:astro-aeo/emdash');
    } catch {
      return [];
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
  },
});
