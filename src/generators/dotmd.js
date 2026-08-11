// @ts-check
import { writeFileSync, readFileSync } from 'node:fs';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { mdPathnameFor } from '../core/page-model.js';
import {
  hasMarkdownAlternateLink,
  matchMarkdownAlternateLinks,
  withMarkdownAlternateLink,
} from '../core/alternate-link.js';

export { hasMarkdownAlternateLink, matchMarkdownAlternateLinks };

/**
 * Write .md companion files and inject <link rel="alternate" type="text/markdown">
 * into each page's <head>.
 *
 * @param {import('../build/collect.js').PageInfo[]} pages
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {ReturnType<typeof import('../build/artifacts.js').createArtifactWriter>} writer
 * @returns {number} count of .md files written
 */
export function emitDotMd(pages, config, writer) {
  if (!config.markdown.enabled) return 0;
  const { alternateLink } = config.markdown;
  let written = 0;

  for (const page of pages) {
    if (page.rendering === 'on-demand') continue;
    if (page.aeoTokens.includes('no-dotmd') || page.directives?.generateMarkdown === false) continue;

    const wrote = writer.write({
      path: page.mdPath,
      owner: 'dotmd',
      route: mdPathnameFor(page.pathname),
      contents: renderMarkdownDocument(page, config),
      onConflict: 'overwrite',
    });
    if (wrote) written++;

    if (alternateLink !== 'never') injectAlternateLink(page, alternateLink, writer);
  }

  return written;
}

/**
 * Inject (or, in 'always' mode, normalize) the markdown alternate link in a
 * page's <head>. Idempotent in 'auto' mode.
 * @param {import('../build/collect.js').PageInfo} page
 * @param {'auto'|'always'} mode
 * @param {ReturnType<typeof import('../build/artifacts.js').createArtifactWriter>} writer
 */
function injectAlternateLink(page, mode, writer) {
  if (writer.isDeferred) {
    writer.stageTransform(
      page.htmlPath,
      'markdown-alternate',
      (html) => withMarkdownAlternateLink(html, page.mdHref, mode),
    );
    return;
  }
  let html;
  try {
    html = readFileSync(page.htmlPath, 'utf8');
  } catch {
    return;
  }

  const updated = withMarkdownAlternateLink(html, page.mdHref, mode);
  if (updated !== html) writeFileSync(page.htmlPath, updated, 'utf8');
}
