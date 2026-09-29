import type { AstroIntegration } from 'astro';
import type { AstroAeoConfig } from './index.js';

export interface EmDashCollectionOptions {
  /**
   * Group this collection's pages under their own `llms.txt` heading. A string is the
   * heading, and its URLs come from the collection's `urlPattern` in the seed file named
   * by `package.json` (`/posts/{slug}` matches `/posts/**`). Pass `{ title, match }`
   * when the pattern starts at the site root, such as `/{slug}`.
   */
  section?: string | { title: string; match: string | string[] };
}

export interface EmDashAeoOptions {
  /**
   * Options for the Astro-AEO integration, which `emdashAeo()` registers for you. Do not
   * also add `aeo()` to `integrations`. Defaults that differ from a plain Astro project:
   * `pages.exclude` gains `/_emdash/**` and `/404`, `pages.catalogs` gains the EmDash
   * catalog, `markdown.negotiation` is `'response'`, and `discovery.robots.enabled` is
   * `false` and `discovery.sitemap.mode` is `'disabled'` because EmDash serves its own
   * `robots.txt` and sitemaps. Use the current option names: legacy 1.0 spellings are
   * rejected here. IndexNow cannot be enabled.
   */
  aeo?: AstroAeoConfig;
  /**
   * Per-collection settings, keyed by collection slug. Every collection with a URL
   * pattern is listed by default; `false` leaves one out.
   */
  collections?: Record<string, false | EmDashCollectionOptions>;
  /**
   * Taxonomy archive routes to list, keyed by taxonomy name, such as
   * `{ category: '/category/{slug}', tag: '/tag/{slug}' }`. EmDash stores no URL for
   * a taxonomy, so archives are listed only when named here, and only for terms that
   * have published entries.
   */
  taxonomies?: Record<string, string>;
  /**
   * Seconds a request-time listing stays fresh before EmDash is read again, so newly
   * published entries appear without a restart. `0` reads on every use; `false` reads
   * once per server process. Default: `10`.
   */
  revalidate?: number | false;
  /** Upper bound on listed pages, matching EmDash's sitemap limit. Default: `50000`. */
  maxEntries?: number;
}

export default function emdashAeo(options?: EmDashAeoOptions): AstroIntegration;

/** The Astro-AEO configuration `emdashAeo()` registers, exposed for inspection and tests. */
export function emdashDefaults(
  options?: EmDashAeoOptions,
  facts?: { patterns?: Record<string, string>; warn?: (message: string) => void },
): AstroAeoConfig;
