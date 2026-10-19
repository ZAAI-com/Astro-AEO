// @ts-check
import { isPageVersion } from '../page-version.js';

/** Render opt-in links from known records only, without mutating authored text.
 * @param {{ markdown: string; versionLinks?: boolean; alternates?: readonly import('../../index.js').PageAlternate[] }} page
 */
export function pageMarkdown(page) {
  if (page.versionLinks !== true || !Array.isArray(page.alternates)) return page.markdown;
  const links = page.alternates.flatMap((alternate) => {
    if (alternate?.kind !== 'version' || !isPageVersion(alternate.version)) return [];
    try {
      const url = new URL(alternate.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return [];
      return [`- Version ${alternate.version}: <${url.href}>`];
    } catch { return []; }
  });
  return links.length ? `${page.markdown.trimEnd()}\n\n---\n\n${[...new Set(links)].join('\n')}\n` : page.markdown;
}
