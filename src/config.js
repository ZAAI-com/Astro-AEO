// @ts-check
import { isPlainObject, mergeLegacy, printMigration } from './lib/config-migrate.js';
import { AeoConfigError } from './lib/errors.js';
import { resolveSitemapPolicy } from './lib/sitemap.js';
import { parseDocument } from './core/html-document.js';
import { assertValidExtractionOptions } from './core/extract/index.js';
import { cloneJsonValue } from './core/json-value.js';
import { assertExactPathname } from './core/artifact-path.js';

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
  const renderers = validateRenderers(userConfig.markdown?.renderers);
  const replacementPaths = validateReplacementPaths(userConfig.artifacts?.replace);
  const metadataDefaults = validateMetadataDefaults(userConfig.metadata?.defaults);
  const schema = validateSchemaOptions(userConfig.schema);
  const validation = validateValidationOptions(userConfig.validation);
  const plugins = validatePlugins(userConfig.plugins);
  if (userConfig.site?.organization !== undefined && !isPlainObject(userConfig.site.organization)) {
    throw new AeoConfigError('astro-aeo: site.organization must be a Schema.org entity or ID reference object.');
  }
  const organization = userConfig.site?.organization === undefined
    ? undefined
    : /** @type {import('./schema.js').SchemaEntity | import('./schema.js').EntityReference} */ (
        cloneConfigJson(userConfig.site.organization, 'site.organization')
      );

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
      defaultLocale: userConfig.site?.defaultLocale,
      organization,
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
      strategy: markdown.strategy ?? 'auto',
      renderers,
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
    artifacts: { replace: replacementPaths },
    metadata: {
      fillMissing: userConfig.metadata?.fillMissing ?? false,
      defaults: metadataDefaults,
    },
    schema,
    validation,
    plugins,
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
    strategy: null,
    renderers: null,
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
    defaultLocale: null,
    organization: PASSTHROUGH,
    profile: { enabled: null, name: null, description: null, website: null, email: null, logo: null, sameAs: null, entityType: null },
  },
  artifacts: { replace: null },
  metadata: { fillMissing: null, defaults: PASSTHROUGH },
  schema: {
    autoInject: null,
    infer: null,
    strictReferences: null,
    corpus: { enabled: null, graphPath: null, mapPath: null },
  },
  validation: { onBuild: null, failOn: null },
  plugins: null,
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
 * @param {import('./index.js').MarkdownRendererConfig[] | undefined} renderers
 * @returns {import('./index.js').MarkdownRendererConfig[]}
 */
function validateRenderers(renderers) {
  if (renderers === undefined) return [];
  if (!Array.isArray(renderers)) {
    throw new AeoConfigError('astro-aeo: markdown.renderers must be an array.');
  }
  let mdx = 0;
  return renderers.map((renderer, index) => {
    if (typeof renderer === 'function') return renderer;
    if (!isPlainObject(renderer)) {
      throw new AeoConfigError(
        `astro-aeo: markdown.renderers[${index}] must be a renderer function or module descriptor.`,
      );
    }
    const module = renderer.module;
    if (!isModuleReference(module)) {
      throw new AeoConfigError(
        `astro-aeo: markdown.renderers[${index}].module must be a non-empty string or URL.`,
      );
    }
    const moduleName = module instanceof URL ? module.href : module.trim();
    if (moduleName === 'astro-aeo/mdx' && ++mdx > 1) {
      throw new AeoConfigError('astro-aeo: markdown.renderers may register astro-aeo/mdx only once.');
    }
    return {
      module,
      ...(renderer.options === undefined
        ? {}
        : { options: cloneConfigJson(renderer.options, `markdown.renderers[${index}].options`) }),
    };
  });
}

/** @param {unknown} value */
function isModuleReference(value) {
  return value instanceof URL || (typeof value === 'string' && value.trim().length > 0);
}

/**
 * @param {string[] | undefined} paths
 * @returns {string[]}
 */
function validateReplacementPaths(paths) {
  if (paths === undefined) return [];
  if (!Array.isArray(paths)) {
    throw new AeoConfigError('astro-aeo: artifacts.replace must be an array of exact pathnames.');
  }
  const normalized = paths.map((path, index) => {
    try {
      return assertExactPathname(path, `artifacts.replace[${index}]`);
    } catch (error) {
      throw new AeoConfigError(`astro-aeo: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new AeoConfigError('astro-aeo: artifacts.replace must not contain duplicate pathnames.');
  }
  return normalized;
}

/** @param {unknown} defaults @returns {import('./index.js').MetadataDefaults} */
function validateMetadataDefaults(defaults) {
  if (defaults === undefined) return {};
  if (!isPlainObject(defaults)) {
    throw new AeoConfigError('astro-aeo: metadata.defaults must be an object.');
  }
  const supported = new Set([
    'title', 'description', 'robots', 'openGraph', 'twitter', 'locale', 'themeColor', 'author',
  ]);
  const unknown = Object.keys(defaults).find((key) => !supported.has(key));
  if (unknown) {
    throw new AeoConfigError(`astro-aeo: metadata.defaults.${unknown} is not a supported 1.2 default.`);
  }
  return /** @type {import('./index.js').MetadataDefaults} */ (
    cloneConfigJson(defaults, 'metadata.defaults')
  );
}

/**
 * @param {import('./index.js').SchemaOptions | undefined} input
 * @returns {Required<import('./index.js').SchemaOptions> & { corpus: Required<import('./index.js').SchemaCorpusOptions> }}
 */
function validateSchemaOptions(input = {}) {
  const infer = input.infer ?? ['website', 'webpage', 'breadcrumbs'];
  if (!Array.isArray(infer) || infer.some((value) => !['website', 'webpage', 'breadcrumbs'].includes(value))) {
    throw new AeoConfigError(
      'astro-aeo: schema.infer must contain only "website", "webpage", and "breadcrumbs".',
    );
  }
  if (new Set(infer).size !== infer.length) {
    throw new AeoConfigError('astro-aeo: schema.infer must not contain duplicates.');
  }
  const graphPath = input.corpus?.graphPath ?? '/schema/graph.jsonld';
  const mapPath = input.corpus?.mapPath ?? '/schema/schema-map.xml';
  try {
    assertExactPathname(graphPath, 'schema.corpus.graphPath');
    assertExactPathname(mapPath, 'schema.corpus.mapPath');
  } catch (error) {
    throw new AeoConfigError(`astro-aeo: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (graphPath === mapPath) {
    throw new AeoConfigError('astro-aeo: schema corpus graphPath and mapPath must be different.');
  }
  return {
    autoInject: input.autoInject ?? true,
    infer: [...infer],
    strictReferences: input.strictReferences ?? true,
    corpus: { enabled: input.corpus?.enabled ?? false, graphPath, mapPath },
  };
}

/**
 * @param {import('./index.js').ValidationOptions | undefined} input
 * @returns {Required<import('./index.js').ValidationOptions>}
 */
function validateValidationOptions(input = {}) {
  const onBuild = input.onBuild ?? 'artifacts';
  const failOn = input.failOn ?? 'error';
  if (!['artifacts', 'recommended', 'off'].includes(onBuild)) {
    throw new AeoConfigError('astro-aeo: validation.onBuild must be "artifacts", "recommended", or "off".');
  }
  if (!['error', 'warning'].includes(failOn)) {
    throw new AeoConfigError('astro-aeo: validation.failOn must be "error" or "warning".');
  }
  return /** @type {Required<import('./index.js').ValidationOptions>} */ ({ onBuild, failOn });
}

/**
 * @param {import('./index.js').AstroAeoPlugin[] | undefined} plugins
 * @returns {import('./index.js').AstroAeoPlugin[]}
 */
function validatePlugins(plugins) {
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins)) throw new AeoConfigError('astro-aeo: plugins must be an array.');
  const names = new Set();
  const resolved = [];
  for (let index = 0; index < plugins.length; index++) {
    const plugin = plugins[index];
    if (!isPlainObject(plugin) || typeof plugin.name !== 'string' || !plugin.name.trim()) {
      throw new AeoConfigError(`astro-aeo: plugins[${index}].name must be a non-empty string.`);
    }
    const name = plugin.name.trim();
    if (name.startsWith('astro-aeo:')) {
      throw new AeoConfigError(`astro-aeo: plugin name "${name}" uses a reserved prefix.`);
    }
    if (names.has(name)) {
      throw new AeoConfigError(`astro-aeo: duplicate plugin name "${name}".`);
    }
    names.add(name);
    if (plugin.apiVersion !== 1) {
      throw new AeoConfigError(`astro-aeo: plugin "${name}" must declare apiVersion: 1.`);
    }
    if (typeof plugin.setup !== 'function') {
      throw new AeoConfigError(`astro-aeo: plugin "${name}" must provide setup(api).`);
    }
    let runtime;
    if (plugin.runtime !== undefined) {
      if (!isPlainObject(plugin.runtime) || !isModuleReference(plugin.runtime.entrypoint)) {
        throw new AeoConfigError(
          `astro-aeo: plugin "${name}" runtime.entrypoint must be a non-empty string or URL.`,
        );
      }
      runtime = {
        ...plugin.runtime,
        ...(plugin.runtime.options === undefined
          ? {}
          : { options: cloneConfigJson(plugin.runtime.options, `plugins[${index}].runtime.options`) }),
      };
    }
    resolved.push({
      ...plugin,
      name,
      ...(runtime === undefined ? {} : { runtime }),
    });
  }
  return resolved;
}

/** @param {unknown} value @param {string} label */
function cloneConfigJson(value, label) {
  try {
    return cloneJsonValue(value, label);
  } catch (error) {
    throw new AeoConfigError(`astro-aeo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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

export { assertExactPathname };
export { resolveSiteMeta } from './core/site-meta.js';
