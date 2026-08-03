// @ts-check
import { createArtifactWriter } from '../build/artifacts.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the robots.txt body from config.
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
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

/**
 * Write /robots.txt. Warns (but still overwrites) when one already exists in the
 * build output, e.g. copied from public/.
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl
 * @param {{ warn: (m: string) => void }} [logger]
 * @param {string} [base]  Astro base path, prefixed onto the emitted URLs.
 * @param {boolean} [sitemapAvailable]  Whether to emit the Sitemap line.
 * @param {ReturnType<typeof createArtifactWriter>} [writer]  Shared writer, when one exists.
 */
export function emitRobotsTxt(distDir, config, siteUrl, logger, base = '', sitemapAvailable = true, writer = undefined) {
  if (!config.discovery.robots.enabled) return;
  const write = writer ?? createArtifactWriter({ distDir, logger: toLogger(logger) });
  write.write({
    path: join(fileURLToPath(distDir), 'robots.txt'),
    owner: 'robotsTxt',
    route: '/robots.txt',
    contents: buildRobotsTxt(config, siteUrl, base, sitemapAvailable),
    onConflict: 'warn-overwrite',
    conflictMessage: 'astro-aeo: overwriting an existing robots.txt in the build output',
  });
}

/**
 * The generators are called directly by tests with a warn-only logger, so fill in
 * the info channel the writer expects.
 * @param {{ warn: (m: string) => void } | undefined} logger
 * @returns {{ info: (m: string) => void; warn: (m: string) => void }}
 */
function toLogger(logger) {
  return { info: () => {}, warn: (m) => logger?.warn(m) };
}
