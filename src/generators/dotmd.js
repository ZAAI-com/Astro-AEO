// @ts-check
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Matches a markdown alternate <link> regardless of whether rel= or type=
// appears first, so an existing (possibly hand-authored) link is detected in
// either attribute order.
const MARKDOWN_ALTERNATE_RE =
  /<link\b(?=[^>]*\brel=(["'])alternate\1)(?=[^>]*\btype=(["'])text\/markdown\2)[^>]*>/i;

/**
 * True when the HTML already contains a markdown alternate link (any attribute
 * order).
 * @param {string} html
 * @returns {boolean}
 */
export function hasMarkdownAlternateLink(html) {
  return MARKDOWN_ALTERNATE_RE.test(html);
}

/**
 * Write .md companion files and inject <link rel="alternate" type="text/markdown">
 * into each page's <head>.
 *
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @returns {number} count of .md files written
 */
export function emitDotMd(pages, config) {
  if (!config.dotmd.enabled) return 0;
  const { includeLastModified, frontmatter, linkTag } = config.dotmd;
  let written = 0;

  for (const page of pages) {
    if (page.aeoTokens.has('no-dotmd')) continue;

    let body = '';
    if (frontmatter) {
      body += '---\n';
      body += `title: ${JSON.stringify(page.title)}\n`;
      body += `url: ${page.url}\n`;
      if (page.description) body += `description: ${JSON.stringify(page.description)}\n`;
      if (includeLastModified && page.lastModified) {
        body += `lastModified: ${isoDate(page.lastModified)}\n`;
      }
      body += '---\n\n';
    }
    body += page.markdown;
    body += '\n';
    if (includeLastModified && page.lastModified && !frontmatter) {
      body += `\n_Last modified: ${isoDate(page.lastModified)}_\n`;
    }

    mkdirSync(dirname(page.mdPath), { recursive: true });
    writeFileSync(page.mdPath, body, 'utf8');
    written++;

    if (linkTag !== 'never') injectAlternateLink(page, linkTag);
  }

  return written;
}

/**
 * Inject (or, in 'always' mode, normalize) the markdown alternate link in a
 * page's <head>. Idempotent in 'auto' mode.
 * @param {import('../lib/collect.js').PageInfo} page
 * @param {'auto'|'always'} mode
 */
function injectAlternateLink(page, mode) {
  let html;
  try {
    html = readFileSync(page.htmlPath, 'utf8');
  } catch {
    return;
  }

  const hasExisting = hasMarkdownAlternateLink(html);
  const tag = `<link rel="alternate" type="text/markdown" href="${page.mdHref}">`;

  let updated;
  if (hasExisting) {
    if (mode !== 'always') return; // 'auto': leave the existing link untouched
    updated = html.replace(MARKDOWN_ALTERNATE_RE, tag);
  } else {
    if (!html.includes('</head>')) return;
    updated = html.replace('</head>', `${tag}</head>`);
  }
  if (updated !== html) writeFileSync(page.htmlPath, updated, 'utf8');
}

/**
 * @param {Date} d
 * @returns {string}
 */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
