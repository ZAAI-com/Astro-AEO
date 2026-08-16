// @ts-check
import { matchesExactPathname } from './artifact-path.js';

/**
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {boolean}
 */
export function isOwnedArtifactPath(pathname, config) {
  if (pathname === '/llms.txt' && config.corpus.index.enabled) return true;
  if (pathname === '/llms-full.txt' && config.corpus.full.enabled) return true;
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return true;
  if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) return true;
  if (
    config.schema.corpus.enabled &&
    (matchesExactPathname(pathname, config.schema.corpus.graphPath) ||
      matchesExactPathname(pathname, config.schema.corpus.mapPath))
  ) return true;
  if (
    config.discovery.sitemap.mode !== 'disabled' &&
    config.discovery.sitemap.alias.enabled &&
    pathname === `/${config.discovery.sitemap.alias.outputFilename.replace(/^\/+/, '')}`
  ) {
    return true;
  }
  return false;
}
