// @ts-check
import { isPlainObject, mergeLegacy } from './lib/config-migrate.js';
import { AeoConfigError } from './lib/errors.js';

/**
 * Default llms.txt sections when the user configures none: a Home rule for "/"
 * plus the "Pages" catch-all (added implicitly via defaultSection). This keeps
 * zero-config output sensible for any site shape.
 * @type {import('./index.js').SectionRule[]}
 */
const DEFAULT_SECTIONS = [{ title: 'Home', match: '/' }];

/**
 * Canonical sections whose readers have been migrated. Legacy keys outside this
 * set are still read from their 1.0 path further down, so lifting them here would
 * silently drop a canonical value. The set grows one section per step and this
 * whole mechanism disappears once every section has moved.
 * @type {Set<string>}
 */
const ACTIVE_CANONICAL_SECTIONS = new Set(['site.profile']);

/**
 * Resolve a user config into a fully-defaulted config object.
 *
 * 1.0 keys are lifted onto their canonical paths first, so everything below reads
 * a single shape. Legacy input warns once per canonical section; a legacy key and
 * its canonical replacement set to different values is a build-stopping error.
 *
 * @param {import('./index.js').AstroAeoConfig} [rawConfig]
 * @param {{ warn: (m: string) => void }} [logger]
 * @returns {import('./index.js').ResolvedAstroAeoConfig}
 */
export function resolveConfig(rawConfig = {}, logger) {
  warnUnknownKeys(/** @type {Record<string, unknown>} */ (rawConfig), CONFIG_SHAPE, logger);

  const { merged, warnings } = mergeLegacy(
    /** @type {Record<string, any>} */ (rawConfig),
    (message) => {
      throw new AeoConfigError(message);
    },
    ACTIVE_CANONICAL_SECTIONS,
  );
  if (logger) for (const warning of warnings) logger.warn(warning);

  const userConfig = /** @type {import('./index.js').AstroAeoConfig} */ (merged);

  const dotmd = userConfig.dotmd ?? {};
  const frontmatter = dotmd.frontmatter ?? dotmd.dotmdMetadata ?? false;
  if (dotmd.dotmdMetadata !== undefined && logger) {
    logger.warn('astro-aeo: `dotmd.dotmdMetadata` is deprecated, use `dotmd.frontmatter`');
  }

  const llmsTxt = userConfig.llmsTxt ?? {};
  const robotsTxt = userConfig.robotsTxt ?? {};
  const profile = userConfig.site?.profile ?? {};

  // The @astrojs/sitemap output name is `${filenameBase}-index.xml` (filenameBase
  // defaults to 'sitemap'). Resolved once so both the sitemapAlias source and the
  // robots.txt Sitemap path track a single source of truth. For a separately
  // registered integration this value is the explicit shared filename hint.
  const sitemapFilenameBase = userConfig.sitemap?.options?.filenameBase ?? 'sitemap';

  return {
    include: userConfig.include ?? ['**'],
    exclude: userConfig.exclude ?? [],
    respectNoindex: userConfig.respectNoindex ?? true,
    stripTitleSuffix: userConfig.stripTitleSuffix ?? false,
    site: {
      name: userConfig.site?.name ?? '',
      description: userConfig.site?.description ?? '',
      profile: {
        enabled: profile.enabled ?? false,
        name: profile.name ?? '',
        description: profile.description ?? '',
        website: profile.website ?? '',
        email: profile.email ?? '',
        logo: profile.logo ?? '',
        sameAs: profile.sameAs ?? [],
        entityType: profile.entityType ?? 'Organization',
      },
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
    sitemap: {
      enabled: userConfig.sitemap?.enabled ?? true,
      // Forwarded verbatim to the @astrojs/sitemap integration (filter,
      // changefreq, priority, lastmod, i18n, entryLimit, ...).
      options: userConfig.sitemap?.options ?? {},
    },
    sitemapAlias: {
      enabled: userConfig.sitemapAlias?.enabled ?? true,
      // Default source tracks the @astrojs/sitemap output name. An explicit
      // sourceFilename always wins.
      sourceFilename: userConfig.sitemapAlias?.sourceFilename ?? `${sitemapFilenameBase}-index.xml`,
      outputFilename: userConfig.sitemapAlias?.outputFilename ?? 'sitemap.xml',
    },
    robotsTxt: {
      enabled: robotsTxt.enabled ?? false,
      universalAllow: robotsTxt.universalAllow ?? true,
      allow: robotsTxt.allow ?? [],
      disallow: robotsTxt.disallow ?? [],
      // The optional public value is resolved to a boolean for the text builder;
      // index.js separately preserves omission as the automatic build policy.
      includeSitemap: robotsTxt.includeSitemap ?? true,
      // Tracks the @astrojs/sitemap output name. The late finalizer verifies this
      // root-relative path before it is interpolated as
      // `${siteUrl}${base}${sitemapPath}` in robots-txt.js.
      sitemapPath: robotsTxt.sitemapPath ?? `/${sitemapFilenameBase}-index.xml`,
      includeLlmsTxt: robotsTxt.includeLlmsTxt ?? true,
      extraLines: robotsTxt.extraLines ?? [],
    },
  };
}

/**
 * Free-form subtree marker. Everything below a PASSTHROUGH is forwarded verbatim
 * to another tool, so validating it would flag that tool's own valid options.
 */
const PASSTHROUGH = Symbol('astro-aeo.passthrough');

/**
 * The whole accepted config shape, at every depth. `null` marks a scalar leaf, a
 * plain object recurses, and PASSTHROUGH stops validation for that subtree.
 *
 * Deprecated aliases (`dotmd.dotmdMetadata`, `domainProfile.contact`) are listed
 * so they are recognized rather than flagged as typos.
 * @type {Record<string, any>}
 */
const CONFIG_SHAPE = {
  include: null,
  exclude: null,
  respectNoindex: null,
  stripTitleSuffix: null,
  site: {
    name: null,
    description: null,
    profile: { enabled: null, name: null, description: null, website: null, email: null, logo: null, sameAs: null, entityType: null },
  },
  dotmd: { enabled: null, linkTag: null, includeLastModified: null, frontmatter: null, dotmdMetadata: null },
  llmsTxt: { enabled: null, sections: null, defaultSection: null, includeDescriptions: null, showLastmod: null, includeNoDotmd: null },
  llmsFullTxt: { enabled: null, mode: null },
  urlMap: { enabled: null, outputFilepath: null },
  robotsTxt: { enabled: null, universalAllow: null, allow: null, disallow: null, includeSitemap: null, sitemapPath: null, includeLlmsTxt: null, extraLines: null },
  domainProfile: { enabled: null, name: null, description: null, website: null, email: null, contact: null, logo: null, sameAs: null, entityType: null },
  sitemap: { enabled: null, options: PASSTHROUGH },
  sitemapAlias: { enabled: null, sourceFilename: null, outputFilename: null },
};

/**
 * Warn on unknown config keys at any depth, so a typo in a three-level path is
 * caught as precisely as a top-level one.
 *
 * Warnings need a sink, so with no logger there is nothing to do. Configuration
 * *errors* are raised regardless: see `mergeLegacy` in `lib/config-migrate.js`.
 * @param {Record<string, unknown>} value
 * @param {any} shape
 * @param {{ warn: (m: string) => void } | undefined} logger
 * @param {string} [path]
 */
function warnUnknownKeys(value, shape, logger, path = '') {
  if (!logger || shape === PASSTHROUGH) return;
  for (const key of Object.keys(value)) {
    const child = shape[key];
    const dotted = path ? `${path}.${key}` : key;
    if (child === undefined) {
      logger.warn(`astro-aeo: unknown config key "${dotted}" (ignored)`);
      continue;
    }
    const nested = value[key];
    if (child === null || !isPlainObject(nested)) continue;
    warnUnknownKeys(nested, child, logger, dotted);
  }
}

/**
 * Resolve the site name/description used in llms.txt headers, following the
 * fallback chain: explicit site.* -> site.profile.* -> homepage <title> -> hostname.
 *
 * @param {import('./index.js').ResolvedAstroAeoConfig} config
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
