// @ts-check
const SOURCE =
  '<link\\b(?=[^>]*\\brel=(["\'])alternate\\1)(?=[^>]*\\btype=(["\'])text/markdown\\2)[^>]*>';
const RE = new RegExp(SOURCE, 'i');

/** @param {string} html */
export function hasMarkdownAlternateLink(html) {
  return RE.test(html);
}

/** @param {string} html */
export function matchMarkdownAlternateLinks(html) {
  return html.match(new RegExp(SOURCE, 'gi')) || [];
}

/**
 * @param {string} html
 * @param {string} href
 * @param {'auto'|'always'} mode
 */
export function withMarkdownAlternateLink(html, href, mode) {
  const safeHref = href
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const tag = `<link rel="alternate" type="text/markdown" href="${safeHref}">`;
  if (RE.test(html)) return mode === 'always' ? html.replace(RE, () => tag) : html;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${tag}</head>`) : html;
}
