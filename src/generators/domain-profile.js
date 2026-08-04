// @ts-check
import { buildDomainProfile } from '../core/render/domain-profile.js';

export { buildDomainProfile } from '../core/render/domain-profile.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Write /.well-known/domain-profile.json (schema.org identity for the site).
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl  Site origin without trailing slash (fallback for website).
 * @param {ReturnType<typeof import('../build/artifacts.js').createArtifactWriter>} writer
 */
export function emitDomainProfile(distDir, config, siteUrl, writer) {
  if (!config.site.profile.enabled) return;
  writer.write({
    path: join(fileURLToPath(distDir), '.well-known', 'domain-profile.json'),
    owner: 'domainProfile',
    route: '/.well-known/domain-profile.json',
    contents: JSON.stringify(buildDomainProfile(config, siteUrl), null, 2),
    onConflict: 'overwrite',
  });
}
