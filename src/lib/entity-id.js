// @ts-check

/**
 * Resolve a component's `id` prop to a JSON-LD `@id`, or `undefined` when it
 * cannot name a distinct entity. A page-relative value such as `#faq` resolves
 * against the page URL. Without a page URL (no `site`), a non-blank value is
 * returned as written. A value that does not parse, or that resolves to the
 * page itself (`""`, `"./"`), is dropped: rendering must not fail, and the page
 * URL already identifies the page's `WebPage`.
 *
 * @param {unknown} id
 * @param {URL} [pageUrl]
 * @returns {string | undefined}
 */
export function resolveEntityId(id, pageUrl) {
  if (typeof id !== 'string' || !id.trim()) return undefined;
  if (pageUrl === undefined) return id;
  let resolved;
  try {
    resolved = new URL(id, pageUrl);
  } catch {
    return undefined;
  }
  if (resolved.hash.length <= 1 && withoutFragment(resolved) === withoutFragment(pageUrl)) return undefined;
  return resolved.href;
}

/** @param {URL} url */
function withoutFragment(url) {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}
