// @ts-check
import TurndownService from 'turndown';

/**
 * Create a configured Turndown instance. One per build so future options can
 * influence the conversion without leaking module-level state between runs.
 * @returns {import('turndown')}
 */
export function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  td.remove(['script', 'style', 'noscript', 'iframe']);

  td.addRule('skipChrome', {
    filter: (node) => node.nodeName === 'NAV' || node.nodeName === 'FOOTER',
    replacement: () => '',
  });

  return td;
}

/**
 * Convert an HTML document to Markdown, preferring the <main> region and
 * falling back to the whole document when no <main> is present.
 * @param {string} html
 * @param {import('turndown')} [td]
 * @returns {string}
 */
export function htmlToMarkdown(html, td = createTurndown()) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const body = mainMatch ? mainMatch[1] : html;
  return td.turndown(body).trim();
}
