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
  const i18n = validateI18nOptions(userConfig.i18n);
  const cache = validateCacheOptions(userConfig.cache);
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
  const corpusSmall = validateCorpusSmallOptions(userConfig.corpus?.small);
  const corpusChunks = validateCorpusChunkOptions(userConfig.corpus?.chunks);
  const corpusManifest = validateCorpusManifestOptions(userConfig.corpus?.manifest);
  const corpusTokenizer = validateCorpusTokenizer(userConfig.corpus?.tokenizer);
  const corpusCompression = validateCorpusCompressionOptions(userConfig.corpus?.compression);
  const corpusUrlMap = userConfig.corpus?.urlMap ?? {};
  const corpusRuntime = userConfig.corpus?.runtime ?? {};
  const robots = validateRobotsOptions(userConfig.discovery?.robots);
  const indexNow = validateIndexNowOptions(userConfig.discovery?.indexNow, logger);
  const sitemap = userConfig.discovery?.sitemap ?? {};
  const alias = sitemap.alias ?? {};
  const profile = userConfig.site?.profile ?? {};
  const pages = userConfig.pages ?? {};
  const devDynamicDiscovery = resolveDevDynamicDiscovery(pages.devDynamicDiscovery);

  const sitemapFilenameBase = sitemap.options?.filenameBase ?? 'sitemap';
  const sitemapMode = sitemap.mode ?? 'auto';
  const sitemapPolicy = sitemapMode === 'disabled'
    ? 'never'
    : resolveSitemapPolicy(robots.includeSitemap);
  const indexEnabled = resolveBoolean(corpusIndex.enabled, 'corpus.index.enabled', true);
  const fullEnabled = resolveBoolean(corpusFull.enabled, 'corpus.full.enabled', true);
  if (
    corpusManifest.enabled &&
    !indexEnabled &&
    !fullEnabled &&
    !corpusSmall.enabled &&
    !corpusChunks.enabled
  ) {
    throw new AeoConfigError(
      'astro-aeo: corpus.manifest.enabled requires at least one enabled corpus index, full, small, or chunks artifact.',
    );
  }

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
      devDynamicDiscovery,
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
    i18n,
    cache,
    corpus: {
      index: {
        enabled: indexEnabled,
        sections: corpusIndex.sections ?? DEFAULT_SECTIONS,
        defaultSection: corpusIndex.defaultSection ?? 'Pages',
        includeDescriptions: corpusIndex.includeDescriptions ?? true,
        showLastModified: corpusIndex.showLastModified ?? false,
        includeHtmlOnly: corpusIndex.includeHtmlOnly ?? false,
      },
      full: {
        enabled: fullEnabled,
        mode: corpusFull.mode ?? 'all',
      },
      small: corpusSmall,
      chunks: corpusChunks,
      manifest: corpusManifest,
      tokenizer: corpusTokenizer,
      compression: corpusCompression,
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
        enabled: robots.enabled,
        policy: robots.policy,
        universalAllow: robots.universalAllow,
        allow: robots.allow,
        disallow: robots.disallow,
        sitemapPolicy,
        includeSitemap: sitemapPolicy !== 'never',
        sitemapPath: robots.sitemapPath ?? `/${sitemapFilenameBase}-index.xml`,
        includeLlmsTxt: robots.includeLlmsTxt,
        extraLines: robots.extraLines,
        ...(robots.contentSignals === undefined ? {} : { contentSignals: robots.contentSignals }),
      },
      indexNow,
    },
  };
}

/**
 * @param {import('./index.js').CorpusSmallOptions | undefined} input
 * @returns {Required<import('./index.js').CorpusSmallOptions>}
 */
function validateCorpusSmallOptions(input = {}) {
  assertOptionObject(input, 'corpus.small');
  return {
    enabled: resolveBoolean(input.enabled, 'corpus.small.enabled', false),
    maxTokens: resolvePositiveSafeInteger(input.maxTokens, 'corpus.small.maxTokens', 20_000),
  };
}

/**
 * @param {import('./index.js').CorpusChunksOptions | undefined} input
 * @returns {Required<import('./index.js').CorpusChunksOptions>}
 */
function validateCorpusChunkOptions(input = {}) {
  assertOptionObject(input, 'corpus.chunks');
  if (input.by !== undefined && input.by !== 'section') {
    throw new AeoConfigError('astro-aeo: corpus.chunks.by must be "section".');
  }
  return {
    enabled: resolveBoolean(input.enabled, 'corpus.chunks.enabled', false),
    maxTokensPerFile: resolvePositiveSafeInteger(
      input.maxTokensPerFile,
      'corpus.chunks.maxTokensPerFile',
      100_000,
    ),
    by: 'section',
  };
}

/**
 * @param {import('./index.js').CorpusManifestOptions | undefined} input
 * @returns {Required<import('./index.js').CorpusManifestOptions>}
 */
function validateCorpusManifestOptions(input = {}) {
  assertOptionObject(input, 'corpus.manifest');
  return { enabled: resolveBoolean(input.enabled, 'corpus.manifest.enabled', false) };
}

/**
 * @param {import('./index.js').CorpusTokenizerOptions | undefined} input
 * @returns {import('./index.js').CorpusTokenizerOptions | undefined}
 */
function validateCorpusTokenizer(input) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input) || !isModuleReference(input.module)) {
    throw new AeoConfigError(
      'astro-aeo: corpus.tokenizer.module must be a non-empty local module specifier or file URL.',
    );
  }
  const module = input.module;
  if (module instanceof URL && module.protocol !== 'file:') {
    throw new AeoConfigError('astro-aeo: corpus.tokenizer.module must be local; remote URL modules are not supported.');
  }
  if (typeof module === 'string' && /^[a-z][a-z\d+.-]*:/i.test(module.trim()) && !/^file:/i.test(module.trim())) {
    throw new AeoConfigError('astro-aeo: corpus.tokenizer.module must be local; remote URL modules are not supported.');
  }
  return {
    module: typeof module === 'string' ? module.trim() : module,
    ...(input.options === undefined
      ? {}
      : { options: cloneConfigJson(input.options, 'corpus.tokenizer.options') }),
  };
}

/**
 * @param {import('./index.js').CorpusCompressionOptions | undefined} input
 * @returns {Required<import('./index.js').CorpusCompressionOptions>}
 */
function validateCorpusCompressionOptions(input = {}) {
  assertOptionObject(input, 'corpus.compression');
  return { gzip: resolveBoolean(input.gzip, 'corpus.compression.gzip', false) };
}

/**
 * @param {import('./index.js').I18nOptions | undefined} input
 * @returns {Required<import('./index.js').I18nOptions>}
 */
function validateI18nOptions(input = {}) {
  assertOptionObject(input, 'i18n');
  const indexes = input.indexes ?? 'auto';
  const unresolvedLanguage = input.unresolvedLanguage ?? 'default';
  if (!['auto', 'global', 'locale', 'both'].includes(indexes)) {
    throw new AeoConfigError('astro-aeo: i18n.indexes must be "auto", "global", "locale", or "both".');
  }
  if (!['default', 'error', 'exclude'].includes(unresolvedLanguage)) {
    throw new AeoConfigError(
      'astro-aeo: i18n.unresolvedLanguage must be "default", "error", or "exclude".',
    );
  }
  return /** @type {Required<import('./index.js').I18nOptions>} */ ({ indexes, unresolvedLanguage });
}

/**
 * @param {import('./index.js').CacheOptions | undefined} input
 * @returns {Required<import('./index.js').CacheOptions>}
 */
function validateCacheOptions(input = {}) {
  assertOptionObject(input, 'cache');
  return { enabled: resolveBoolean(input.enabled, 'cache.enabled', true) };
}

/**
 * @param {import('./index.js').DiscoveryRobotsOptions | undefined} input
 * @returns {Required<Omit<import('./index.js').DiscoveryRobotsOptions, 'includeSitemap' | 'sitemapPath' | 'contentSignals'>> & { includeSitemap?: boolean; sitemapPath?: string; contentSignals?: import('./index.js').ContentSignalsOptions }}
 */
function validateRobotsOptions(input = {}) {
  assertOptionObject(input, 'discovery.robots');
  const policy = input.policy ?? 'custom';
  if (!['custom', 'open', 'search-open-training-closed', 'retrieval-only', 'closed'].includes(policy)) {
    throw new AeoConfigError(
      'astro-aeo: discovery.robots.policy must be "custom", "open", "search-open-training-closed", "retrieval-only", or "closed".',
    );
  }
  if (policy !== 'custom' && input.universalAllow !== undefined) {
    throw new AeoConfigError(
      'astro-aeo: discovery.robots.universalAllow cannot be configured with a crawler policy preset.',
    );
  }
  const allow = validateStringArray(input.allow, 'discovery.robots.allow');
  const disallow = validateStringArray(input.disallow, 'discovery.robots.disallow');
  if (policy !== 'custom') {
    for (const token of [...allow, ...disallow]) {
      if (!/^[^\s\u0000-\u001f\u007f]+$/u.test(token)) {
        throw new AeoConfigError(
          'astro-aeo: crawler policy allow and disallow overrides must be non-empty user-agent tokens without whitespace or control characters.',
        );
      }
    }
    const allowed = new Set(allow.map((token) => token.toLowerCase()));
    const overlap = disallow.find((token) => allowed.has(token.toLowerCase()));
    if (overlap !== undefined) {
      throw new AeoConfigError(
        `astro-aeo: discovery.robots.allow and discovery.robots.disallow overlap at "${overlap}".`,
      );
    }
  }
  let contentSignals;
  if (input.contentSignals !== undefined) {
    if (!isPlainObject(input.contentSignals)) {
      throw new AeoConfigError('astro-aeo: discovery.robots.contentSignals must be an object.');
    }
    for (const key of /** @type {const} */ (['search', 'aiInput', 'aiTrain'])) {
      if (typeof input.contentSignals[key] !== 'boolean') {
        throw new AeoConfigError(
          `astro-aeo: discovery.robots.contentSignals.${key} must be explicitly set to a boolean.`,
        );
      }
    }
    contentSignals = /** @type {import('./index.js').ContentSignalsOptions} */ ({
      search: input.contentSignals.search,
      aiInput: input.contentSignals.aiInput,
      aiTrain: input.contentSignals.aiTrain,
    });
  }
  if (input.includeSitemap !== undefined && typeof input.includeSitemap !== 'boolean') {
    throw new AeoConfigError('astro-aeo: discovery.robots.includeSitemap must be a boolean when supplied.');
  }
  if (input.sitemapPath !== undefined && typeof input.sitemapPath !== 'string') {
    throw new AeoConfigError('astro-aeo: discovery.robots.sitemapPath must be a string.');
  }
  return /** @type {any} */ ({
    enabled: resolveBoolean(input.enabled, 'discovery.robots.enabled', false),
    policy,
    universalAllow: resolveBoolean(
      input.universalAllow,
      'discovery.robots.universalAllow',
      true,
    ),
    allow,
    disallow,
    includeSitemap: input.includeSitemap,
    sitemapPath: input.sitemapPath,
    includeLlmsTxt: resolveBoolean(input.includeLlmsTxt, 'discovery.robots.includeLlmsTxt', true),
    extraLines: validateStringArray(input.extraLines, 'discovery.robots.extraLines'),
    ...(contentSignals === undefined ? {} : { contentSignals }),
  });
}

/**
 * @param {import('./index.js').DiscoveryIndexNowOptions | undefined} input
 * @param {{ warn: (message: string) => void } | undefined} logger
 * @returns {import('./index.js').ResolvedIndexNowOptions}
 */
function validateIndexNowOptions(input = {}, logger) {
  assertOptionObject(input, 'discovery.indexNow');
  let submit = input.submit ?? 'changed';
  const state = input.state ?? 'public';
  if (!['changed', 'all'].includes(submit)) {
    throw new AeoConfigError('astro-aeo: discovery.indexNow.submit must be "changed" or "all".');
  }
  if (!['public', 'private', 'stateless'].includes(state)) {
    throw new AeoConfigError(
      'astro-aeo: discovery.indexNow.state must be "public", "private", or "stateless".',
    );
  }
  if (state === 'stateless' && submit === 'changed') {
    submit = 'all';
    logger?.warn(
      'astro-aeo: discovery.indexNow.state "stateless" submits all current URLs; submit "changed" was resolved to "all".',
    );
  }
  const key = validateIndexNowKey(input.key, 'discovery.indexNow.key', true);
  const keyLocation = validateKeyLocation(input.keyLocation, 'discovery.indexNow.keyLocation');
  /** @type {import('./index.js').IndexNowOriginOptions[]} */
  let origins = [];
  if (input.origins !== undefined) {
    if (!Array.isArray(input.origins)) {
      throw new AeoConfigError('astro-aeo: discovery.indexNow.origins must be an array.');
    }
    const seen = new Set();
    origins = input.origins.map((entry, index) => {
      const label = `discovery.indexNow.origins[${index}]`;
      if (!isPlainObject(entry)) {
        throw new AeoConfigError(`astro-aeo: ${label} must be an origin descriptor.`);
      }
      assertOnlyKeys(
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (entry)),
        ['origin', 'key', 'keyLocation'],
        label,
      );
      const origin = validateIndexNowOrigin(entry.origin, `${label}.origin`);
      if (seen.has(origin)) {
        throw new AeoConfigError(`astro-aeo: discovery.indexNow.origins contains duplicate origin "${origin}".`);
      }
      seen.add(origin);
      const originKey = entry.key === undefined
        ? undefined
        : validateIndexNowKey(entry.key, `${label}.key`, false);
      const originKeyLocation = validateKeyLocation(entry.keyLocation, `${label}.keyLocation`);
      return {
        origin,
        ...(originKey === undefined ? {} : { key: originKey }),
        ...(originKeyLocation === undefined ? {} : { keyLocation: originKeyLocation }),
      };
    });
  }
  return /** @type {import('./index.js').ResolvedIndexNowOptions} */ ({
    enabled: resolveBoolean(input.enabled, 'discovery.indexNow.enabled', false),
    submit,
    state,
    strict: resolveBoolean(input.strict, 'discovery.indexNow.strict', false),
    key,
    keyLocation,
    origins,
  });
}

/**
 * @param {import('./index.js').IndexNowKeySource | undefined} input
 * @param {string} label
 * @param {boolean} useDefault
 * @returns {import('./index.js').IndexNowKeySource | undefined}
 */
function validateIndexNowKey(input, label, useDefault) {
  if (input === undefined) {
    return useDefault ? { source: 'env', name: 'ASTRO_AEO_INDEXNOW_KEY' } : undefined;
  }
  if (!isPlainObject(input) || !['env', 'file'].includes(input.source)) {
    throw new AeoConfigError(`astro-aeo: ${label}.source must be "env" or "file".`);
  }
  assertOnlyKeys(input, input.source === 'env' ? ['source', 'name'] : ['source', 'path'], label);
  if (input.source === 'env') {
    if ('path' in input && input.path !== undefined) {
      throw new AeoConfigError(`astro-aeo: ${label}.path is valid only when source is "file".`);
    }
    const name = input.name ?? 'ASTRO_AEO_INDEXNOW_KEY';
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new AeoConfigError(`astro-aeo: ${label}.name must be a valid environment variable name.`);
    }
    return { source: 'env', name };
  }
  if ('name' in input && input.name !== undefined) {
    throw new AeoConfigError(`astro-aeo: ${label}.name is valid only when source is "env".`);
  }
  if (typeof input.path !== 'string' || input.path.trim() === '' || input.path.includes('\0')) {
    throw new AeoConfigError(`astro-aeo: ${label}.path must be a non-empty local file path.`);
  }
  return { source: 'file', path: input.path };
}

/** @param {unknown} value @param {string} label */
function validateKeyLocation(value, label) {
  if (value === undefined) return undefined;
  try {
    return assertExactPathname(value, label);
  } catch (error) {
    throw new AeoConfigError(`astro-aeo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** @param {unknown} value @param {string} label */
function validateIndexNowOrigin(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AeoConfigError(`astro-aeo: ${label} must be a public HTTPS origin.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AeoConfigError(`astro-aeo: ${label} must be a public HTTPS origin.`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    (parsed.port && parsed.port !== '443')
  ) {
    throw new AeoConfigError(`astro-aeo: ${label} must contain only an HTTPS host on port 443.`);
  }
  return parsed.origin;
}

/** @param {unknown} value @param {string} label @param {boolean} fallback */
function resolveBoolean(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AeoConfigError(`astro-aeo: ${label} must be a boolean.`);
  return value;
}

/** @param {unknown} value @param {string} label @param {number} fallback */
function resolvePositiveSafeInteger(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    throw new AeoConfigError(`astro-aeo: ${label} must be a positive safe integer.`);
  }
  return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} label */
function validateStringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new AeoConfigError(`astro-aeo: ${label} must be an array of strings.`);
  }
  return [...value];
}

/** @param {unknown} value @param {string} label */
function assertOptionObject(value, label) {
  if (!isPlainObject(value)) throw new AeoConfigError(`astro-aeo: ${label} must be an object.`);
}

/** @param {Record<string, unknown>} value @param {string[]} keys @param {string} label */
function assertOnlyKeys(value, keys, label) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new AeoConfigError(`astro-aeo: ${label}.${unexpected} is not supported.`);
  }
}

/**
 * @param {unknown} value
 * @returns {'startup'|'hot'|false}
 */
function resolveDevDynamicDiscovery(value) {
  if (value === undefined) return 'startup';
  if (value === 'startup' || value === 'hot' || value === false) return value;
  throw new AeoConfigError(
    'astro-aeo: pages.devDynamicDiscovery must be "startup", "hot", or false.',
  );
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
  pages: {
    include: null,
    exclude: null,
    respectNoindex: null,
    stripTitleSuffix: null,
    devDynamicDiscovery: null,
    catalogs: null,
  },
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
    small: { enabled: null, maxTokens: null },
    chunks: { enabled: null, maxTokensPerFile: null, by: null },
    manifest: { enabled: null },
    tokenizer: { module: null, options: PASSTHROUGH },
    compression: { gzip: null },
    urlMap: { enabled: null, outputFilepath: null },
    runtime: { maxPages: null },
  },
  i18n: { indexes: null, unresolvedLanguage: null },
  cache: { enabled: null },
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
    robots: {
      enabled: null,
      policy: null,
      universalAllow: null,
      allow: null,
      disallow: null,
      includeSitemap: null,
      sitemapPath: null,
      includeLlmsTxt: null,
      extraLines: null,
      contentSignals: { search: null, aiInput: null, aiTrain: null },
    },
    indexNow: {
      enabled: null,
      submit: null,
      state: null,
      strict: null,
      key: { source: null, name: null, path: null },
      keyLocation: null,
      origins: null,
    },
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
