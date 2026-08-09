// @ts-check
import { isPlainObject, mergeLegacy, printMigration } from './lib/config-migrate.js';
import { AeoConfigError } from './lib/errors.js';
import { resolveSitemapPolicy } from './lib/sitemap.js';
import { parseDocument } from './core/html-document.js';
import { assertValidExtractionOptions } from './core/extract/index.js';

/** @type {import('./index.js').SectionRule[]} */
const DEFAULT_SECTIONS = [{ title: 'Home', match: '/' }];

/**
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

  if (logger && process.env.AEO_PRINT_MIGRATION) {
    const migration = printMigration(/** @type {Record<string, any>} */ (rawConfig));
    if (migration) logger.warn(migration);
  }

  const userConfig = /** @type {import('./index.js').AstroAeoConfig} */ (merged);
  validateExtractionSelectors(userConfig.markdown?.extraction);
  validateCatalogs(userConfig.pages?.catalogs);

  const markdown = userConfig.markdown ?? {};
  const extraction = markdown.extraction ?? {};
  const corpusIndex = userConfig.corpus?.index ?? {};
  const corpusFull = userConfig.corpus?.full ?? {};
  const corpusUrlMap = userConfig.corpus?.urlMap ?? {};
  const corpusRuntime = userConfig.corpus?.runtime ?? {};
  const robots = userConfig.discovery?.robots ?? {};
  const sitemap = userConfig.discovery?.sitemap ?? {};
  const alias = sitemap.alias ?? {};
  const profile = userConfig.site?.profile ?? {};
  const pages = userConfig.pages ?? {};

  const sitemapFilenameBase = sitemap.options?.filenameBase ?? 'sitemap';
  const sitemapMode = sitemap.mode ?? 'auto';
  const sitemapPolicy = sitemapMode === 'disabled'
    ? 'never'
    : resolveSitemapPolicy(robots.includeSitemap);

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
      runtime: {
        maxPages: resolveRuntimeMaxPages(corpusRuntime.maxPages),
      },
    },
    discovery: {
      sitemap: {
        mode: sitemapMode,
        options: sitemap.options ?? {},
        alias: {
          enabled: alias.enabled ?? true,
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
        includeSitemap: sitemapPolicy !== 'never',
        sitemapPath: robots.sitemapPath ?? `/${sitemapFilenameBase}-index.xml`,
        includeLlmsTxt: robots.includeLlmsTxt ?? true,
        extraLines: robots.extraLines ?? [],
      },
    },
  };
}

/** @param {{ module: string }[] | undefined} catalogs */
function validateCatalogs(catalogs) {
  if (catalogs === undefined) return;
  if (!Array.isArray(catalogs)) {
    throw new AeoConfigError('astro-aeo: pages.catalogs must be an array of module descriptors.');
  }
  for (let index = 0; index < catalogs.length; index++) {
    if (!isPlainObject(catalogs[index]) || typeof catalogs[index].module !== 'string' || !catalogs[index].module.trim()) {
      throw new AeoConfigError(
        `astro-aeo: pages.catalogs[${index}].module must be a non-empty module specifier.`,
      );
    }
  }
}

/** @param {import('./index.js').ExtractionOptions | undefined} extraction */
function validateExtractionSelectors(extraction) {
  if (!extraction) return;
  assertValidExtractionOptions(
    parseDocument('<html></html>'),
    'markdown.extraction',
    extraction,
  );
}

const PASSTHROUGH = Symbol('astro-aeo.passthrough');

/**
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
    runtime: { maxPages: null },
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
 * @param {number | 'unlimited' | undefined} value
 * @returns {number | 'unlimited'}
 */
function resolveRuntimeMaxPages(value) {
  if (value === undefined) return 50;
  if (value === 'unlimited') return value;
  if (Number.isInteger(value) && value > 0) return value;
  throw new AeoConfigError(
    'astro-aeo: corpus.runtime.maxPages must be a positive integer or "unlimited".',
  );
}

/**
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

export { resolveSiteMeta } from './core/site-meta.js';
