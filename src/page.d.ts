import type { AeoPageProps } from '../components/index.js';
import type { ExtractionDiagnostics } from './index.js';
import type { EntityReference, SchemaEntity } from './schema.js';

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
  image?: string;
  language?: string;
  published?: Date | string;
  lastModified?: Date | string;
  authors?: EntityReference[];
  entities?: SchemaEntity[];
  directives?: Partial<{
    index: boolean;
    includeInLlms: boolean;
    includeInLlmsFull: boolean;
    generateMarkdown: boolean;
  }>;
  /** Where the content came from, recorded in diagnostics. */
  sourcePath?: string;
  sourceKind?: PageSource['kind'];
}

/**
 * Normalize what a page knows about itself into the props for `<AeoPage>`.
 *
 * Extraction can only approximate a page from its rendered HTML. Where a page was
 * built from Markdown, this hands the original to astro-aeo instead.
 */
export declare function defineAeoPage(input?: AeoPageInput): AeoPageProps;

export interface PageSource {
  kind: 'markdown' | 'mdx' | 'astro' | 'cms' | 'rendered' | 'custom';
  path?: string;
  body?: string;
  hash?: string;
}

/** One serializable page a catalog reports. */
export interface PageDescriptor {
  /** Root-relative path, e.g. `/blog/hello`. */
  pathname: string;
  routePattern?: string;
  rendering?: 'prerendered' | 'on-demand';
  title?: string;
  description?: string;
  image?: string;
  language?: string;
  markdown?: string;
  dates?: { published?: string; modified?: string };
  authors?: EntityReference[];
  entities?: SchemaEntity[];
  directives?: Partial<{
    index: boolean;
    includeInLlms: boolean;
    includeInLlmsFull: boolean;
    generateMarkdown: boolean;
  }>;
  /** ISO date. */
  lastModified?: string;
  sourcePath?: string;
  source?: PageSource;
  extraction?: ExtractionDiagnostics;
}

/** @deprecated Use PageDescriptor. */
export type CatalogPage = PageDescriptor;

export interface CatalogContext {
  command: 'dev' | 'build' | 'preview';
  siteUrl: string;
  base: string;
  trailingSlash: 'always' | 'never' | 'ignore';
}

/**
 * Lists pages the build cannot discover for itself, which is every route
 * generated from data rather than from a file. Without a catalog such a route is
 * simply absent from the corpus; astro-aeo does not crawl to find them. A module
 * exporting this contract must be compiled to Node-loadable `.js`, `.mjs`, or
 * `.cjs` before it is configured as a catalog entrypoint.
 */
export interface PageCatalog {
  name?: string;
  listPages(context: CatalogContext): PageDescriptor[] | Promise<PageDescriptor[]>;
}
