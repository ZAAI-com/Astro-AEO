// @ts-check
import { matchesExactPathname } from './artifact-path.js';
import { isPotentialCorpusArtifactPath } from './corpus-artifacts.js';

/**
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {boolean}
 */
export function isOwnedArtifactPath(pathname, config) {
  if (isPotentialCorpusArtifactPath(pathname, config)) return true;
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return true;
  if (
    pathname === '/.well-known/astro-aeo-indexnow-v1.json' &&
    config.discovery.indexNow.enabled &&
    config.discovery.indexNow.state === 'public'
  ) return true;
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
