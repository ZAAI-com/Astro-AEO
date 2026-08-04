// @ts-check

/**
 * The site name and description used in corpus headers. Pure, and in core
 * because the runtime needs it too and `config.js` reads the filesystem.
 */

/**
 * Resolve the site name/description used in llms.txt headers, following the
 * fallback chain: explicit site.* -> site.profile.* -> homepage <title> -> hostname.
 *
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl
 * @param {string} homeTitle  <title> of the built home page (may be empty).
 * @returns {{ name: string; description: string }}
 */
export function resolveSiteMeta(config, siteUrl, homeTitle) {
  let name = config.site.name || config.site.profile.name || homeTitle;
  if (!name && siteUrl) {
    try {
      name = new URL(siteUrl).hostname;
    } catch {
      name = siteUrl;
    }
  }
  const description = config.site.description || config.site.profile.description || '';
  return { name: name || 'Site', description };
}
