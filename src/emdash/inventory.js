// @ts-check
import { interpolateUrlPattern } from './url-pattern.js';

/**
 * The EmDash page inventory: every published entry of a collection that has a
 * public URL, and optionally the archive page of every taxonomy term in use.
 * It applies EmDash's own sitemap rules (an SEO-enabled collection; published,
 * not deleted, has a slug, not marked noindex) and reads only EmDash's public plugin read API, which
 * is injected here so this module stays pure and testable.
 *
 * A collection without a URL pattern is skipped rather than guessed at: the
 * Marketing template's `pages` collection has none, and its entries are served
 * by fixed routes (`/`, `/pricing`) that Astro-AEO already knows.
 *
 * @typedef {{ slug: string; urlPattern: string | null; routable: boolean; hasSeo?: boolean; titleField?: string | null }} EmDashCollection
 * @typedef {{
 *   id: string;
 *   slug: string | null;
 *   locale?: string | null;
 *   data: Record<string, unknown>;
 *   seo?: { title?: string | null; description?: string | null; noIndex?: boolean };
 *   publishedAt?: string | null;
 *   updatedAt?: string | null;
 * }} EmDashEntry
 * @typedef {{ slug: string; label?: string; description?: string; count?: number; children?: EmDashTerm[] }} EmDashTerm
 * @typedef {{
 *   listCollections: () => Promise<EmDashCollection[]>;
 *   listEntries: (collection: string, options: { cursor?: string; limit: number; locale?: string }) => Promise<{ items: EmDashEntry[]; cursor?: string | null }>;
 *   getTerms: (taxonomy: string) => Promise<EmDashTerm[]>;
 *   i18n?: { defaultLocale: string; prefixDefaultLocale?: boolean } | null;
 *   warn?: (message: string) => void;
 * }} EmDashReader
 * @typedef {{
 *   collections?: Record<string, false | object>;
 *   taxonomies?: Record<string, string>;
 *   maxEntries?: number;
 * }} EmDashInventoryOptions
 * @typedef {import('../content.js').CmsPage} CmsPage
 */

const PAGE_SIZE = 100;
export const DEFAULT_MAX_ENTRIES = 50_000;
const DESCRIPTION_FIELDS = ['excerpt', 'summary', 'description'];

/**
 * @param {EmDashReader} reader
 * @param {EmDashInventoryOptions} [options]
 * @returns {Promise<CmsPage[]>}
 */
export async function listEmDashPages(reader, options = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const disabled = new Set(
    Object.entries(options.collections ?? {})
      .filter(([, setting]) => setting === false)
      .map(([slug]) => slug),
  );
  const locale = reader.i18n?.defaultLocale;
  const localePrefix = locale && reader.i18n?.prefixDefaultLocale ? `/${locale}` : '';
  /** @type {CmsPage[]} */
  const pages = [];
  let truncated = false;

  for (const collection of await reader.listCollections()) {
    if (!collection.routable || !collection.urlPattern || disabled.has(collection.slug)) continue;
    // EmDash's sitemap leaves out collections with SEO turned off.
    if (collection.hasSeo === false) continue;
    /** @type {string | undefined} */
    let cursor;
    do {
      const result = await reader.listEntries(collection.slug, {
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(locale ? { locale } : {}),
      });
      for (const entry of result.items) {
        if (pages.length >= maxEntries) {
          truncated = true;
          break;
        }
        const page = entryPage(collection, entry, localePrefix);
        if (page) pages.push(page);
      }
      cursor = result.cursor ?? undefined;
    } while (cursor && !truncated);
    if (truncated) break;
  }

  for (const [taxonomy, pattern] of Object.entries(options.taxonomies ?? {})) {
    if (truncated) break;
    for (const term of flattenTerms(await reader.getTerms(taxonomy))) {
      if (!term.count) continue;
      if (pages.length >= maxEntries) {
        truncated = true;
        break;
      }
      const path = interpolateUrlPattern({ pattern, slug: term.slug });
      if (!path) continue;
      pages.push({
        id: `taxonomy/${taxonomy}/${term.slug}`,
        pathname: `${localePrefix}${path}`,
        rendering: 'on-demand',
        ...(term.label ? { title: term.label } : {}),
        ...(term.description ? { description: term.description } : {}),
      });
    }
  }

  if (truncated) {
    reader.warn?.(
      `astro-aeo: the EmDash catalog stopped at maxEntries (${maxEntries}); later entries are not listed.`,
    );
  }
  return pages;
}

/**
 * @param {EmDashCollection} collection
 * @param {EmDashEntry} entry
 * @param {string} localePrefix
 * @returns {CmsPage | null}
 */
function entryPage(collection, entry, localePrefix) {
  const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
  if (!slug || entry.seo?.noIndex === true || !collection.urlPattern) return null;
  const path = interpolateUrlPattern({
    pattern: collection.urlPattern,
    slug,
    id: entry.id,
    date: entry.publishedAt,
  });
  if (!path) return null;
  const title = firstText(entry.seo?.title, collection.titleField ? entry.data[collection.titleField] : undefined, entry.data.title);
  const description = firstText(entry.seo?.description, ...DESCRIPTION_FIELDS.map((field) => entry.data[field]));
  const published = entry.publishedAt ?? undefined;
  const modified = entry.updatedAt ?? undefined;
  return {
    id: `${collection.slug}/${entry.id}`,
    pathname: `${localePrefix}${path}`,
    rendering: 'on-demand',
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(published || modified
      ? { dates: { ...(published ? { published } : {}), ...(modified ? { modified } : {}) } }
      : {}),
  };
}

/** @param {unknown[]} values @returns {string | undefined} */
function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** @param {EmDashTerm[]} terms @returns {EmDashTerm[]} */
function flattenTerms(terms) {
  return terms.flatMap((term) => [term, ...flattenTerms(term.children ?? [])]);
}
