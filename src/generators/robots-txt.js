// @ts-check
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the robots.txt body from config.
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteUrl  Site origin without trailing slash.
 * @returns {string}
 */
export function buildRobotsTxt(config, siteUrl) {
  const { allow, disallow, includeSitemap, sitemapPath, includeLlmsTxt, extraLines } = config.robotsTxt;
  const lines = [];

  for (const bot of allow) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  for (const bot of disallow) lines.push(`User-agent: ${bot}`, 'Disallow: /', '');
  if (allow.length === 0 && disallow.length === 0) lines.push('User-agent: *', 'Allow: /', '');

  if (includeSitemap && siteUrl) lines.push(`Sitemap: ${siteUrl}${sitemapPath}`);
  if (includeLlmsTxt && config.llmsTxt.enabled && siteUrl) {
    // Not a standard robots directive; emitted as a comment as a hint for
    // humans and crawlers. Primary discovery is the per-page alternate link.
    lines.push(`# llms.txt: ${siteUrl}/llms.txt`);
  }
  for (const extra of extraLines) lines.push(extra);

  return `${lines.join('\n')}\n`;
}

/**
 * Write /robots.txt. Warns (but still overwrites) when one already exists in the
 * build output, e.g. copied from public/.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteUrl
 * @param {{ warn: (m: string) => void }} [logger]
 */
export function emitRobotsTxt(distDir, config, siteUrl, logger) {
  if (!config.robotsTxt.enabled) return;
  const outPath = join(fileURLToPath(distDir), 'robots.txt');
  if (existsSync(outPath) && logger) {
    logger.warn('astro-aeo: overwriting an existing robots.txt in the build output');
  }
  writeFileSync(outPath, buildRobotsTxt(config, siteUrl), 'utf8');
}
