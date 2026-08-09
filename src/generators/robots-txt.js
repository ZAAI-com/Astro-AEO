// @ts-check
import { createArtifactWriter } from '../build/artifacts.js';
import { buildRobotsTxt } from '../core/render/robots-txt.js';

export { buildRobotsTxt } from '../core/render/robots-txt.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
