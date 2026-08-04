// @ts-check
import { isPlainObject, mergeLegacy, printMigration } from './lib/config-migrate.js';
import { AeoConfigError } from './lib/errors.js';
import { resolveSitemapPolicy } from './lib/sitemap.js';
import { parseDocument } from './core/html-document.js';
import { assertValidSelectors } from './core/extract/index.js';

/**
 * Default llms.txt sections when the user configures none: a Home rule for "/"
 * plus the "Pages" catch-all (added implicitly via defaultSection). This keeps
 * zero-config output sensible for any site shape.
 * @type {import('./index.js').SectionRule[]}
 */
const DEFAULT_SECTIONS = [{ title: 'Home', match: '/' }];

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
  );
  if (logger) for (const warning of warnings) logger.warn(warning);

  // Opt-in, because a full config block in the build log is noise for anyone who
  // is not actively migrating.
  if (logger && process.env.AEO_PRINT_MIGRATION) {
    const migration = printMigration(/** @type {Record<string, any>} */ (rawConfig));
    if (migration) logger.warn(migration);
  }

  const userConfig = /** @type {import('./index.js').AstroAeoConfig} */ (merged);
  validateExtractionSelectors(userConfig.markdown?.extraction);

  const markdown = userConfig.markdown ?? {};
  const extraction = markdown.extraction ?? {};
  const corpusIndex = userConfig.corpus?.index ?? {};
  const corpusFull = userConfig.corpus?.full ?? {};
  const corpusUrlMap = userConfig.corpus?.urlMap ?? {};
  const robots = userConfig.discovery?.robots ?? {};
  const sitemap = userConfig.discovery?.sitemap ?? {};
  const alias = sitemap.alias ?? {};
  const profile = userConfig.site?.profile ?? {};
  const pages = userConfig.pages ?? {};

  // The @astrojs/sitemap output name is `${filenameBase}-index.xml` (filenameBase
  // defaults to 'sitemap'). Resolved once so both the alias source and the
  // robots.txt Sitemap path track a single source of truth. For a separately
  // registered integration this value is the explicit shared filename hint.
  //
  // Read from the MERGED config, never from the raw input: a project still using
  // the 1.0 `sitemap.options` would otherwise fall back to the default base and
  // advertise `/sitemap-index.xml` while its real file is `${base}-index.xml`.
  const sitemapFilenameBase = sitemap.options?.filenameBase ?? 'sitemap';

  // The public setting is an optional boolean, and all three states are
  // meaningful: omitted verifies the build output, true forces the line for a
  // runtime-only sitemap, false suppresses it. Collapsing to a boolean here would
  // lose "omitted", so the distinction is resolved into `sitemapPolicy` instead of
  // being recovered from the raw user config elsewhere.
  const sitemapPolicy = resolveSitemapPolicy(robots.includeSitemap);

  return {
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
    pages: {
      include: pages.include ?? ['**'],
      exclude: pages.exclude ?? [],
      respectNoindex: pages.respectNoindex ?? true,
      stripTitleSuffix: pages.stripTitleSuffix ?? false,
      catalogs: pages.catalogs ?? [],
    },
    markdown: {
      enabled: markdown.enabled ?? true,
      alternateLink: markdown.alternateLink ?? 'auto',
      includeLastModified: markdown.includeLastModified ?? true,
      frontmatter: markdown.frontmatter ?? false,
      negotiation: markdown.negotiation ?? 'off',
      extraction: {
        selectors: extraction.selectors ?? ['article', 'main'],
        removeSelectors: extraction.removeSelectors ?? ['nav', 'footer'],
        keepSelectors: extraction.keepSelectors ?? [],
      },
    },
    corpus: {
      index: {
        enabled: corpusIndex.enabled ?? true,
        sections: corpusIndex.sections ?? DEFAULT_SECTIONS,
        defaultSection: corpusIndex.defaultSection ?? 'Pages',
        includeDescriptions: corpusIndex.includeDescriptions ?? true,
        showLastModified: corpusIndex.showLastModified ?? false,
        includeHtmlOnly: corpusIndex.includeHtmlOnly ?? false,
      },
      full: {
        enabled: corpusFull.enabled ?? true,
        mode: corpusFull.mode ?? 'all',
      },
      urlMap: {
        enabled: corpusUrlMap.enabled ?? false,
        outputFilepath: corpusUrlMap.outputFilepath ?? 'docs/Url-Map.md',
      },
    },
    discovery: {
      sitemap: {
        mode: sitemap.mode ?? 'auto',
        // Forwarded verbatim to the @astrojs/sitemap integration (filter,
        // changefreq, priority, lastmod, i18n, entryLimit, ...).
        options: sitemap.options ?? {},
        alias: {
          enabled: alias.enabled ?? true,
          // Default source tracks the @astrojs/sitemap output name. An explicit
          // sourceFilename always wins.
          sourceFilename: alias.sourceFilename ?? `${sitemapFilenameBase}-index.xml`,
          outputFilename: alias.outputFilename ?? 'sitemap.xml',
        },
      },
      robots: {
        enabled: robots.enabled ?? false,
        universalAllow: robots.universalAllow ?? true,
        allow: robots.allow ?? [],
        disallow: robots.disallow ?? [],
        sitemapPolicy,
        // Equivalent to the old `includeSitemap ?? true` for all three inputs, but
        // derived from the policy so the two can never disagree.
        includeSitemap: sitemapPolicy !== 'never',
        // Tracks the @astrojs/sitemap output name. The late finalizer verifies this
        // root-relative path before it is interpolated as
        // `${siteUrl}${base}${sitemapPath}` in robots-txt.js.
        sitemapPath: robots.sitemapPath ?? `/${sitemapFilenameBase}-index.xml`,
        includeLlmsTxt: robots.includeLlmsTxt ?? true,
        extraLines: robots.extraLines ?? [],
      },
    },
  };
}

/**
 * Run each user-supplied selector once so a typo fails the build with the path
 * that caused it, rather than silently matching nothing on every page. The
 * shipped defaults are not re-validated, so a zero-config build never parses a
 * probe document.
 * @param {import('./index.js').ExtractionOptions | undefined} extraction
 */
function validateExtractionSelectors(extraction) {
  if (!extraction) return;
  /** @type {Document | undefined} */
  let probe;
  for (const key of /** @type {const} */ (['selectors', 'removeSelectors', 'keepSelectors'])) {
    const value = extraction[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    probe = probe ?? parseDocument('<html></html>');
    assertValidSelectors(probe, `markdown.extraction.${key}`, value);
  }
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
  pages: { include: null, exclude: null, respectNoindex: null, stripTitleSuffix: null, catalogs: null },
  markdown: {
    enabled: null,
    alternateLink: null,
    includeLastModified: null,
    frontmatter: null,
    negotiation: null,
    extraction: { selectors: null, removeSelectors: null, keepSelectors: null },
  },
  corpus: {
    index: { enabled: null, sections: null, defaultSection: null, includeDescriptions: null, showLastModified: null, includeHtmlOnly: null },
    full: { enabled: null, mode: null },
    urlMap: { enabled: null, outputFilepath: null },
  },
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
  discovery: {
    sitemap: {
      mode: null,
      options: PASSTHROUGH,
      alias: { enabled: null, sourceFilename: null, outputFilename: null },
    },
    robots: { enabled: null, universalAllow: null, allow: null, disallow: null, includeSitemap: null, sitemapPath: null, includeLlmsTxt: null, extraLines: null },
  },
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

// Moved to core/site-meta.js so the runtime can use it; re-exported for callers.
export { resolveSiteMeta } from './core/site-meta.js';
