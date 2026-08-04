import type { AeoPageProps } from '../components/index.js';

export type { AeoPageProps };

export interface AeoPageInput {
  /** Authored Markdown, used instead of extracting from the rendered HTML. */
  markdown?: string;
  /**
   * A content-collection entry. Its `body` becomes the Markdown and its `data`
   * supplies the title, description and dates when they are not given directly.
   */
  source?: unknown;
  title?: string;
  description?: string;
  lastModified?: Date | string;
  /** Where the content came from, recorded in diagnostics. */
  sourcePath?: string;
}

/**
 * Normalize what a page knows about itself into the props for `<AeoPage>`.
 *
 * Extraction can only approximate a page from its rendered HTML. Where a page was
 * built from Markdown, this hands the original to astro-aeo instead.
 */
export declare function defineAeoPage(input?: AeoPageInput): AeoPageProps;

/** One entry a catalog reports. */
export interface CatalogPage {
  /** Root-relative path, e.g. `/blog/hello`. */
  pathname: string;
  /** ISO date. */
  lastModified?: string;
}

/**
 * Lists pages the build cannot discover for itself, which is every route
 * generated from data rather than from a file. Without a catalog such a route is
 * simply absent from the corpus; astro-aeo does not crawl to find them.
 */
export interface PageCatalog {
  name?: string;
  listPages(): CatalogPage[] | Promise<CatalogPage[]>;
}
