// @ts-check
import { defineAeoPage } from './page.js';

/**
 * Helpers for content collections and headless CMS sources. Everything here is
 * plain data in, plain data out: nothing imports `astro:content`, so a catalog
 * built with these helpers stays loadable by Node before Vite exists.
 *
 * @typedef {import('./page.js').PageDescriptor} PageDescriptor
 * @typedef {import('./page.js').PageCatalog} PageCatalog
 * @typedef {import('./page.js').CatalogContext} CatalogContext
 */

/**
 * Props for `<AeoPage>` from a content-collection entry. The entry's `body`
 * becomes the authored Markdown and its `data` supplies metadata; `overrides`
 * win over both.
 *
 * @param {unknown} entry
 * @param {Omit<import('./page.js').AeoPageInput, 'source'>} [overrides]
 */
export function contentPage(entry, overrides = {}) {
  return defineAeoPage({ ...overrides, source: entry });
}

/**
 * A serializable catalog descriptor from a content-collection entry. The caller
 * names the pathname because only the project knows how an entry maps to a route.
 *
 * @param {unknown} entry
 * @param {{ pathname: string } & Partial<PageDescriptor>} page
 * @returns {PageDescriptor}
 */
export function contentDescriptor(entry, page) {
  if (!page || typeof page.pathname !== 'string' || !page.pathname.startsWith('/')) {
    throw new TypeError('astro-aeo: contentDescriptor() needs a root-relative pathname');
  }
  const props = defineAeoPage({ source: entry });
  const { pathname, ...overrides } = page;
  const dates = {
    ...(props.published ? { published: props.published } : {}),
    ...(props.lastModified ? { modified: props.lastModified } : {}),
    ...overrides.dates,
  };
  const sourcePath = overrides.sourcePath ?? props.sourcePath;
  return {
    pathname,
    ...(props.title ? { title: props.title } : {}),
    ...(props.description ? { description: props.description } : {}),
    ...(props.image ? { image: props.image } : {}),
    ...(props.language ? { language: props.language } : {}),
    ...(props.version ? { version: props.version } : {}),
    ...(props.markdown !== undefined ? { markdown: props.markdown } : {}),
    ...(props.lastModified ? { lastModified: props.lastModified } : {}),
    ...overrides,
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(overrides.source ?? (props.sourceKind
      ? { source: { kind: props.sourceKind, ...(sourcePath ? { path: sourcePath } : {}) } }
      : {})),
  };
}

/**
 * A page catalog over entries the project loads itself (a JSON export, a glob of
 * files, a prebuilt index). An entry mapped to `null` or `undefined` is left out.
 *
 * @template T
 * @param {{
 *   name?: string;
 *   entries: (context: CatalogContext) => Iterable<T> | Promise<Iterable<T>>;
 *   toPage: (entry: T, context: CatalogContext) => ({ pathname: string } & Partial<PageDescriptor>) | null | undefined;
 * }} options
 * @returns {PageCatalog}
 */
export function defineContentCatalog(options) {
  if (typeof options?.entries !== 'function' || typeof options.toPage !== 'function') {
    throw new TypeError('astro-aeo: defineContentCatalog() needs entries() and toPage()');
  }
  return {
    ...(options.name ? { name: options.name } : {}),
    async listPages(context) {
      /** @type {PageDescriptor[]} */
      const pages = [];
      for (const entry of await options.entries(context)) {
        const page = options.toPage(entry, context);
        if (page) pages.push(contentDescriptor(entry, page));
      }
      return pages;
    },
  };
}

/**
 * A page catalog over a headless CMS. Every page is stamped `source.kind: 'cms'`
 * and identified as `cms:<adapter>:<id>`, so diagnostics name the CMS record and
 * never a local file. Fetching, credentials and caching stay in the adapter: this
 * wrapper adds no network access of its own.
 *
 * @param {import('./content.js').CmsAdapter} adapter
 * @returns {PageCatalog}
 */
export function defineCmsAdapter(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !/^[a-z\d][a-z\d-]*$/i.test(adapter.name)) {
    throw new TypeError('astro-aeo: defineCmsAdapter() needs a name of letters, digits and hyphens');
  }
  if (typeof adapter.listPages !== 'function') {
    throw new TypeError('astro-aeo: defineCmsAdapter() needs listPages()');
  }
  return {
    name: adapter.name,
    async listPages(context) {
      /** @type {PageDescriptor[]} */
      const pages = [];
      for (const page of await adapter.listPages(context)) {
        const { id, ...descriptor } = page;
        const recordId = typeof id === 'string' && id ? id : page.pathname;
        const sourcePath = `cms:${adapter.name}:${recordId}`;
        pages.push({
          ...descriptor,
          sourcePath,
          source: { ...descriptor.source, kind: 'cms', path: sourcePath },
        });
      }
      return pages;
    },
  };
}
