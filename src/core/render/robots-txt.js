// @ts-check

/**
 * The robots.txt body. Pure, so the build and the runtime emit the same text.
 */

/**
 * Build the robots.txt body from config.
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl  Site origin without trailing slash.
 * @param {string} [base]   Astro base path (e.g. "" or "/docs"); prefixed onto
 *                          the Sitemap and llms.txt URLs, which deploy under it.
 * @param {boolean} [sitemapAvailable]  Whether the configured sitemap should be
 *                          advertised. The late build finalizer verifies static
 *                          output; explicit config may force runtime sitemaps.
 * @returns {string}
 */
export function buildRobotsTxt(config, siteUrl, base = '', sitemapAvailable = true) {
  const { universalAllow, allow, disallow, includeSitemap, sitemapPath, includeLlmsTxt, extraLines } = config.discovery.robots;
  const b = base && base !== '/' ? base.replace(/\/$/, '') : '';
  const lines = [];

  // Lead with an explicit open policy for unlisted crawlers, unless the user
  // opted out or already declared a "*" group in allow/disallow/extraLines
  // (which would duplicate it).
  const hasWildcard =
    allow.includes('*') ||
    disallow.includes('*') ||
    extraLines.some((line) => /^user-agent:\s*\*(?:\s|$)/i.test(line.trim()));
  if (universalAllow && !hasWildcard) lines.push('User-agent: *', 'Allow: /', '');

  for (const bot of allow) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  for (const bot of disallow) lines.push(`User-agent: ${bot}`, 'Disallow: /', '');

  if (includeSitemap && sitemapAvailable && siteUrl) lines.push(`Sitemap: ${siteUrl}${b}${sitemapPath}`);
  if (includeLlmsTxt && config.corpus.index.enabled && siteUrl) {
    // Not a standard robots directive; emitted as a comment as a hint for
    // humans and crawlers. Primary discovery is the per-page alternate link.
    lines.push(`# llms.txt: ${siteUrl}${b}/llms.txt`);
  }
  for (const extra of extraLines) lines.push(extra);

  return `${lines.join('\n')}\n`;
}
