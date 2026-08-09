// @ts-check

/**
 * @typedef {object} MarkdownDocPage
 * @property {string} title
 * @property {string} url
 * @property {string} description
 * @property {string} markdown
 * @property {string | undefined} [lastModified] ISO timestamp.
 */

/**
 * Render the body of a `.md` companion.
 *
 * This is the single definition of what a `.md` file contains. The build writes
 * the result to disk and the dev server returns it as a response body, so the
 * two cannot disagree. They previously did: the dev server had its own copy that
 * omitted `lastModified` entirely, in the frontmatter and in the footer.
 *
 * @param {MarkdownDocPage} page
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @returns {string}
 */
export function renderMarkdownDocument(page, config) {
  const { includeLastModified, frontmatter } = config.markdown;
  const showLastModified = includeLastModified && Boolean(page.lastModified);

  let body = '';
  if (frontmatter) {
    body += '---\n';
    body += `title: ${JSON.stringify(page.title)}\n`;
    body += `url: ${page.url}\n`;
    if (page.description) body += `description: ${JSON.stringify(page.description)}\n`;
    if (showLastModified) body += `lastModified: ${isoDate(/** @type {string} */ (page.lastModified))}\n`;
    body += '---\n\n';
  }

  body += page.markdown;
  if (!page.markdown.endsWith('\n')) body += '\n';

  // The footer is the no-frontmatter way to carry the same fact, so it is
  // suppressed when frontmatter already states it.
  if (showLastModified && !frontmatter) {
    body += `\n_Last modified: ${isoDate(/** @type {string} */ (page.lastModified))}_\n`;
  }

  return body;
}

/**
 * @param {string} value ISO timestamp.
 * @returns {string}
 */
export function isoDate(value) {
  return value.slice(0, 10);
}
