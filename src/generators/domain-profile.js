// @ts-check
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the domain-profile object from config.
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteUrl  Site origin (fallback for website).
 * @returns {Record<string, unknown>}
 */
export function buildDomainProfile(config, siteUrl) {
  const dp = config.domainProfile;
  const website = dp.website || siteUrl;
  return {
    '@context': 'https://schema.org',
    '@type': dp.entityType,
    name: dp.name,
    ...(dp.description && { description: dp.description }),
    ...(website && { url: website }),
    ...(dp.contact && { email: dp.contact }),
    ...(dp.logo && { logo: dp.logo }),
    ...(dp.sameAs && dp.sameAs.length && { sameAs: dp.sameAs }),
  };
}

/**
 * Write /.well-known/domain-profile.json (schema.org identity for the site).
 *
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteUrl  Site origin without trailing slash (fallback for website).
 */
export function emitDomainProfile(distDir, config, siteUrl) {
  if (!config.domainProfile.enabled) return;
  const wellKnownDir = join(fileURLToPath(distDir), '.well-known');
  mkdirSync(wellKnownDir, { recursive: true });
  const profile = buildDomainProfile(config, siteUrl);
  writeFileSync(join(wellKnownDir, 'domain-profile.json'), JSON.stringify(profile, null, 2), 'utf8');
}
