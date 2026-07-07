// @ts-check

/**
 * Default llms.txt sections when the user configures none: a Home rule for "/"
 * plus the "Pages" catch-all (added implicitly via defaultSection). This keeps
 * zero-config output sensible for any site shape.
 * @type {import('./index.js').SectionRule[]}
 */
const DEFAULT_SECTIONS = [{ title: 'Home', match: '/' }];

/**
 * Resolve a user config into a fully-defaulted config object. Emits warnings
 * for unknown top-level keys and the deprecated `dotmd.dotmdMetadata` alias.
 *
 * @param {import('./index.js').AstroAeoConfig} [userConfig]
 * @param {{ warn: (m: string) => void }} [logger]
 * @returns {import('./index.js').ResolvedAeoConfig}
 */
export function resolveConfig(userConfig = {}, logger) {
  warnUnknownKeys(/** @type {Record<string, unknown>} */ (userConfig), logger);

  const dotmd = userConfig.dotmd ?? {};
  const frontmatter = dotmd.frontmatter ?? dotmd.dotmdMetadata ?? false;
  if (dotmd.dotmdMetadata !== undefined && logger) {
    logger.warn('astro-aeo: `dotmd.dotmdMetadata` is deprecated, use `dotmd.frontmatter`');
  }

  const llmsTxt = userConfig.llmsTxt ?? {};
  const robotsTxt = userConfig.robotsTxt ?? {};
  const domainProfile = userConfig.domainProfile ?? {};

  return {
    include: userConfig.include ?? ['**'],
    exclude: userConfig.exclude ?? [],
    respectNoindex: userConfig.respectNoindex ?? true,
    stripTitleSuffix: userConfig.stripTitleSuffix ?? false,
    site: {
      name: userConfig.site?.name ?? '',
      description: userConfig.site?.description ?? '',
    },
    dotmd: {
      enabled: dotmd.enabled ?? true,
      linkTag: dotmd.linkTag ?? 'auto',
      includeLastModified: dotmd.includeLastModified ?? true,
      frontmatter,
      dotmdMetadata: frontmatter,
    },
    llmsTxt: {
      enabled: llmsTxt.enabled ?? true,
      sections: llmsTxt.sections ?? DEFAULT_SECTIONS,
      defaultSection: llmsTxt.defaultSection ?? 'Pages',
      includeDescriptions: llmsTxt.includeDescriptions ?? true,
      showLastmod: llmsTxt.showLastmod ?? false,
      includeNoDotmd: llmsTxt.includeNoDotmd ?? false,
    },
    llmsFullTxt: {
      enabled: userConfig.llmsFullTxt?.enabled ?? true,
      mode: userConfig.llmsFullTxt?.mode ?? 'all',
    },
    urlMap: {
      enabled: userConfig.urlMap?.enabled ?? false,
      outputFilepath: userConfig.urlMap?.outputFilepath ?? 'docs/Url-Map.md',
    },
    robotsTxt: {
      enabled: robotsTxt.enabled ?? false,
      allow: robotsTxt.allow ?? [],
      disallow: robotsTxt.disallow ?? [],
      includeSitemap: robotsTxt.includeSitemap ?? true,
      sitemapPath: robotsTxt.sitemapPath ?? '/sitemap-index.xml',
      includeLlmsTxt: robotsTxt.includeLlmsTxt ?? true,
      extraLines: robotsTxt.extraLines ?? [],
    },
    domainProfile: {
      enabled: domainProfile.enabled ?? false,
      name: domainProfile.name ?? '',
      description: domainProfile.description ?? '',
      website: domainProfile.website ?? '',
      contact: domainProfile.contact ?? '',
      logo: domainProfile.logo ?? '',
      sameAs: domainProfile.sameAs ?? [],
      entityType: domainProfile.entityType ?? 'Organization',
    },
  };
}

const KNOWN_KEYS = new Set([
  'include',
  'exclude',
  'respectNoindex',
  'stripTitleSuffix',
  'site',
  'dotmd',
  'llmsTxt',
  'llmsFullTxt',
  'urlMap',
  'robotsTxt',
  'domainProfile',
]);

/**
 * @param {Record<string, unknown>} userConfig
 * @param {{ warn: (m: string) => void }} [logger]
 */
function warnUnknownKeys(userConfig, logger) {
  if (!logger) return;
  for (const key of Object.keys(userConfig)) {
    if (!KNOWN_KEYS.has(key)) logger.warn(`astro-aeo: unknown config key "${key}" (ignored)`);
  }
}

/**
 * Resolve the site name/description used in llms.txt headers, following the
 * fallback chain: explicit site.* -> domainProfile.* -> homepage <title> -> hostname.
 *
 * @param {import('./index.js').ResolvedAeoConfig} config
 * @param {string} siteUrl
 * @param {string} homeTitle  <title> of the built home page (may be empty).
 * @returns {{ name: string; description: string }}
 */
export function resolveSiteMeta(config, siteUrl, homeTitle) {
  let name = config.site.name || config.domainProfile.name || homeTitle;
  if (!name && siteUrl) {
    try {
      name = new URL(siteUrl).hostname;
    } catch {
      name = siteUrl;
    }
  }
  const description = config.site.description || config.domainProfile.description || '';
  return { name: name || 'Site', description };
}
