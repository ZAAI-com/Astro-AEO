// @ts-check
import { createTechArticle } from '../schema.js';
import { starlightMarkdown } from './markdown.js';

/**
 * @typedef {object} StarlightAeoRuntimeOptions
 * @property {{ pagination: boolean; edit: boolean }} links
 * @property {boolean} techArticle
 */

/**
 * Build the inferred source marker for one Starlight route. Only facts Starlight
 * already resolved are used: nothing is guessed, and a page whose source cannot
 * be converted says so instead of shipping partial Markdown.
 *
 * @param {any} route `Astro.locals.starlightRoute`
 * @param {StarlightAeoRuntimeOptions} options
 * @returns {import('../core/extract/marker.js').PageMarker | null}
 */
export function starlightMarker(route, options) {
  const entry = route?.entry;
  const title = entry?.data?.title;
  if (!entry || typeof title !== 'string' || !title || route.id === '404' || entry.id === '404') return null;

  const filePath = typeof entry.filePath === 'string' ? entry.filePath : undefined;
  const mdx = filePath?.endsWith('.mdx') === true;
  const description = typeof entry.data.description === 'string' ? entry.data.description : undefined;
  const language = typeof route.lang === 'string' ? route.lang : undefined;
  const modified = route.lastUpdated instanceof Date && !Number.isNaN(route.lastUpdated.getTime())
    ? route.lastUpdated.toISOString()
    : undefined;

  /** @type {import('../core/extract/marker.js').PageMarker} */
  const marker = {
    title,
    ...(description ? { description } : {}),
    ...(language ? { language } : {}),
    ...(modified ? { lastModified: modified } : {}),
    ...(filePath ? { sourcePath: filePath, sourceKind: mdx ? 'mdx' : 'markdown' } : {}),
  };

  const converted = typeof entry.body === 'string' ? starlightMarkdown(entry.body, { mdx }) : { fallback: 'no-source' };
  if ('markdown' in converted) {
    marker.markdown = [`# ${title}`, '', converted.markdown.trimEnd(), ...footer(route, options), ''].join('\n');
  } else {
    marker.sourceFallback = converted.fallback;
  }

  if (options.techArticle) {
    marker.entities = [createTechArticle({
      headline: title,
      ...(description ? { description } : {}),
      ...(language ? { inLanguage: language } : {}),
      ...(modified ? { dateModified: modified } : {}),
    })];
  }
  return marker;
}

/** @param {any} route @param {StarlightAeoRuntimeOptions} options @returns {string[]} */
function footer(route, options) {
  /** @type {string[]} */
  const links = [];
  if (options.links.pagination) {
    for (const [label, link] of /** @type {const} */ ([['Previous', route.pagination?.prev], ['Next', route.pagination?.next]])) {
      if (typeof link?.href === 'string' && typeof link.label === 'string') {
        links.push(`- ${label}: [${link.label.replace(/[[\]\\]/g, '\\$&')}](${encodeURI(link.href)})`);
      }
    }
  }
  if (options.links.edit && route.editUrl instanceof URL) links.push(`- Edit this page: <${route.editUrl.href}>`);
  return links.length > 0 ? ['', '---', '', ...links] : [];
}
