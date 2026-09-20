// @ts-check
import { writeFileSync, readFileSync } from 'node:fs';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { hasMarkdownCompanion } from '../core/render/llms-txt.js';
import { mdPathnameFor } from '../core/page-model.js';
import { normalizeOrigin } from '../core/locale.js';
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
 * @param {{ siteUrl?: string; diagnostics?: import('../index.js').Diagnostic[] }} [options]
 * @returns {number} count of .md files written
 */
export function emitDotMd(pages, config, writer, options = {}) {
  if (!config.markdown.enabled) return 0;
  const { alternateLink } = config.markdown;
  const buildOrigin = options.siteUrl ? normalizeOrigin(options.siteUrl) : null;
  let written = 0;

  for (const page of pages) {
    if (!hasMarkdownCompanion(page, config)) continue;

    // A companion is written into this build's own namespace at `page.mdPath`, and
    // only catalog descriptors ever carry an explicit origin. Two of them naming
    // different origins can share a pathname, and both would claim the same file
    // under the same owner, which the duplicate-writer warning cannot see, so the
    // later one silently replaced the earlier. The corpus planner already excludes
    // foreign-origin pages, so skipping keeps the companion set consistent with it.
    if (buildOrigin && page.origin && normalizeOrigin(page.origin) !== buildOrigin) {
      options.diagnostics?.push({
        version: 1,
        code: 'catalog-foreign-origin-companion',
        severity: 'warning',
        message:
          `Catalog page ${page.pathname} is published on ${page.origin}, so no .md companion was ` +
          'written into this origin\'s output.',
        pathname: page.pathname,
      });
      continue;
    }

    const wrote = writer.write({
      path: page.mdPath,
      owner: 'dotmd',
      route: mdPathnameFor(page.pathname),
      contents: renderMarkdownDocument(page, config),
      onConflict: 'overwrite',
    });
    if (wrote) written++;

    if (alternateLink !== 'never' && page.htmlPath) {
      injectAlternateLink(page, alternateLink, writer);
    }
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
