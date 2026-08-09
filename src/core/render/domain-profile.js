// @ts-check

/**
 * The /.well-known/domain-profile.json body. Pure, so the build and the runtime
 * emit the same object.
 */

/**
 * Build the domain-profile object from config.
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl  Site origin (fallback for website).
 * @returns {Record<string, unknown>}
 */
export function buildDomainProfile(config, siteUrl) {
  const dp = config.site.profile;
  const website = dp.website || siteUrl;
  return {
    '@context': 'https://schema.org',
    '@type': dp.entityType,
    name: dp.name,
    ...(dp.description && { description: dp.description }),
    ...(website && { url: website }),
    ...contactFields(dp.email),
    ...(dp.logo && { logo: dp.logo }),
    ...(dp.sameAs && dp.sameAs.length && { sameAs: dp.sameAs }),
  };
}

/**
 * Map a contact value to the right schema.org property by shape: an http(s) URL
 * becomes a `contactPoint`, a value containing "@" becomes `email`, and anything
 * else becomes `telephone`. http is checked first so a contact URL containing
 * "@" is not misread as an email. Non-string values (a config mistake) are
 * ignored rather than throwing.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function contactFields(value) {
  if (typeof value !== 'string' || !value) return {};
  if (/^https?:\/\//i.test(value)) return { contactPoint: { '@type': 'ContactPoint', url: value } };
  if (value.includes('@')) return { email: value };
  return { telephone: value };
}
