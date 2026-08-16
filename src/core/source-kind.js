// @ts-check

const SOURCE_KINDS = new Set(['markdown', 'mdx', 'astro', 'cms', 'rendered', 'custom']);

/**
 * @param {unknown} value
 * @returns {value is 'markdown'|'mdx'|'astro'|'cms'|'rendered'|'custom'}
 */
export function isSourceKind(value) {
  return typeof value === 'string' && SOURCE_KINDS.has(value);
}

/**
 * Infer the provenance kind for an authored path or rendered representation.
 *
 * @param {string | undefined} path
 * @param {boolean} authoredMarkdown
 * @returns {'markdown'|'mdx'|'astro'|'cms'|'rendered'|'custom'}
 */
export function sourceKindFor(path, authoredMarkdown) {
  if (path && /^cms:/i.test(path)) return 'cms';
  if (path && /\.mdx(?:$|[?#])/i.test(path)) return 'mdx';
  if (path && /\.md(?:$|[?#])/i.test(path)) return 'markdown';
  if (path && /\.astro(?:$|[?#])/i.test(path)) return 'astro';
  if (path || authoredMarkdown) return 'custom';
  return 'rendered';
}
