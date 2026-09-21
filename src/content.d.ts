import type { AeoPageInput, AeoPageProps, CatalogContext, PageCatalog, PageDescriptor } from './page.js';

export type { CatalogContext, PageCatalog, PageDescriptor };

/** A descriptor the caller supplies: the pathname is required, everything else overrides the entry. */
export type ContentPageInput = { pathname: string } & Partial<PageDescriptor>;

/**
 * Props for `<AeoPage>` from a content-collection entry. The entry's `body`
 * becomes the authored Markdown and its `data` supplies metadata; `overrides`
 * win over both.
 */
export declare function contentPage(entry: unknown, overrides?: Omit<AeoPageInput, 'source'>): AeoPageProps;

/**
 * A serializable catalog descriptor from a content-collection entry. The caller
 * names the pathname because only the project knows how an entry maps to a route.
 */
export declare function contentDescriptor(entry: unknown, page: ContentPageInput): PageDescriptor;

export interface ContentCatalogOptions<T> {
  name?: string;
  /**
   * Load the entries. A catalog module is imported by Node before Vite exists, so
   * it cannot import `astro:content`: read a JSON export, a file glob, or an index
   * the project builds.
   */
  entries(context: CatalogContext): Iterable<T> | Promise<Iterable<T>>;
  /** Map one entry to its page, or return `null` to leave it out. */
  toPage(entry: T, context: CatalogContext): ContentPageInput | null | undefined;
}

export declare function defineContentCatalog<T>(options: ContentCatalogOptions<T>): PageCatalog;

/** One page as a CMS adapter reports it. `id` is the CMS record identifier. */
export type CmsPage = PageDescriptor & { id?: string };

/**
 * A headless CMS source. Fetching, credentials and caching belong to the
 * adapter; Astro-AEO adds no network access of its own.
 */
export interface CmsAdapter {
  /** Letters, digits and hyphens. Appears in diagnostics as `cms:<name>:<id>`. */
  name: string;
  listPages(context: CatalogContext): Iterable<CmsPage> | Promise<Iterable<CmsPage>>;
}

/** Wrap a CMS adapter as a page catalog whose pages carry `source.kind: 'cms'`. */
export declare function defineCmsAdapter(adapter: CmsAdapter): PageCatalog;
