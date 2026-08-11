const boolean = (description, defaultValue) => ({
  type: 'boolean',
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});

const string = (description, defaultValue) => ({
  type: 'string',
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});

const stringArray = (description, defaultValue) => ({
  type: 'array',
  description,
  items: { type: 'string' },
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});

const object = (properties, description) => ({
  type: 'object',
  description,
  properties,
  additionalProperties: false,
});

const deprecated = (schema, replacement) => ({
  ...schema,
  deprecated: true,
  description: `${schema.description} Deprecated: use ${replacement}.`,
});

const sectionRule = {
  type: 'object',
  required: ['title', 'match'],
  properties: {
    title: { type: 'string', minLength: 1 },
    match: {
      description:
        'A pathname glob or list of globs. JavaScript configuration also accepts RegExp and predicate functions.',
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
    },
  },
  additionalProperties: false,
};

const entityTypes = [
  'Organization',
  'Person',
  'Blog',
  'NGO',
  'Community',
  'Project',
  'CreativeWork',
  'SoftwareApplication',
  'Thing',
];

const profileProperties = {
  enabled: boolean('Generate /.well-known/domain-profile.json.', false),
  name: string('Published entity name.', ''),
  description: string('Published entity description.', ''),
  website: string('Entity website. Defaults to the configured Astro site.', ''),
  email: string('Email, contact URL, or telephone value.', ''),
  logo: string('Logo URL.', ''),
  sameAs: stringArray('Related profile URLs.', []),
  entityType: {
    type: 'string',
    description: 'Schema.org entity type.',
    enum: entityTypes,
    default: 'Organization',
  },
};

const legacyProfileProperties = {
  ...profileProperties,
  contact: deprecated(string('Legacy contact value.', ''), 'domainProfile.email'),
};

const indexProperties = {
  enabled: boolean('Generate /llms.txt.', true),
  sections: {
    type: 'array',
    description: 'Ordered llms.txt section rules. First match wins.',
    items: sectionRule,
    default: [{ title: 'Home', match: '/' }],
  },
  defaultSection: {
    description: 'Section for unmatched pages, or false to drop them.',
    anyOf: [{ type: 'string' }, { const: false }],
    default: 'Pages',
  },
  includeDescriptions: boolean('Include page descriptions.', true),
  showLastModified: boolean('Show page modification dates.', false),
  includeHtmlOnly: boolean('List pages without Markdown companions using their HTML URLs.', false),
};

const fullProperties = {
  enabled: boolean('Generate /llms-full.txt.', true),
  mode: {
    type: 'string',
    description: 'Which pages to inline in the full corpus.',
    enum: ['all', 'index', 'first-page-only'],
    default: 'all',
  },
};

const urlMapProperties = {
  enabled: boolean('Generate a URL map in the project.', false),
  outputFilepath: string('Project-relative URL-map destination.', 'docs/Url-Map.md'),
};

const robotsProperties = {
  enabled: boolean('Generate /robots.txt.', false),
  universalAllow: boolean('Emit a leading wildcard allow group.', true),
  allow: stringArray('Crawler user-agents to allow.', []),
  disallow: stringArray('Crawler user-agents to disallow.', []),
  includeSitemap: boolean('Force or suppress the Sitemap line. Omit to auto-detect.'),
  sitemapPath: string('Root-relative sitemap path.', '/sitemap-index.xml'),
  includeLlmsTxt: boolean('Emit the llms.txt discovery comment.', true),
  extraLines: stringArray('Verbatim lines appended to robots.txt.', []),
};

const sitemapAliasProperties = {
  enabled: boolean('Mirror the generated sitemap index to /sitemap.xml when free.', true),
  sourceFilename: string('Sitemap index filename to mirror.', 'sitemap-index.xml'),
  outputFilename: string('Conventional alias filename.', 'sitemap.xml'),
};

const extractionProperties = {
  selectors: stringArray('Content selectors tried in order.', ['article', 'main']),
  removeSelectors: stringArray('Elements removed before conversion.', ['nav', 'footer']),
  keepSelectors: stringArray('Elements retained as sanitized raw HTML.', []),
};

const markdownProperties = {
  enabled: boolean('Generate .md companion pages.', true),
  strategy: {
    type: 'string',
    description: 'Shared Markdown source resolution strategy.',
    enum: ['auto'],
    default: 'auto',
  },
  renderers: {
    type: 'array',
    description: 'Importable Markdown renderer descriptors. Inline functions are available in JavaScript config for prerendered builds.',
    items: {
      ...object(
        {
          module: { type: 'string', minLength: 1 },
          options: { description: 'Strict JSON renderer options.' },
        },
        'One importable renderer.',
      ),
      required: ['module'],
    },
    default: [],
  },
  alternateLink: {
    type: 'string',
    description: 'How Markdown alternate links are injected.',
    enum: ['auto', 'always', 'never'],
    default: 'auto',
  },
  includeLastModified: boolean('Append the last-modified date to Markdown.', true),
  frontmatter: boolean('Prepend YAML frontmatter to Markdown.', false),
  negotiation: {
    type: 'string',
    description: 'On-demand Accept negotiation behavior.',
    enum: ['off', 'response', 'redirect'],
    default: 'off',
  },
  extraction: object(extractionProperties, 'Rendered HTML extraction settings.'),
};

const legacyDotmdProperties = {
  enabled: deprecated(boolean('Generate .md companion pages.', true), 'markdown.enabled'),
  linkTag: deprecated(
    {
      type: 'string',
      description: 'How Markdown alternate links are injected.',
      enum: ['auto', 'always', 'never'],
      default: 'auto',
    },
    'markdown.alternateLink',
  ),
  includeLastModified: deprecated(
    boolean('Append the last-modified date to Markdown.', true),
    'markdown.includeLastModified',
  ),
  frontmatter: deprecated(boolean('Prepend YAML frontmatter to Markdown.', false), 'markdown.frontmatter'),
  dotmdMetadata: deprecated(boolean('Prepend YAML frontmatter to Markdown.', false), 'markdown.frontmatter'),
};

const stripTitleSuffix = {
  description:
    'Suffix or list of suffixes removed from titles, or false. JavaScript configuration also accepts RegExp.',
  anyOf: [
    { type: 'string' },
    { type: 'array', items: { type: 'string' } },
    { const: false },
  ],
  default: false,
};

const canonicalProperties = {
  site: object(
    {
      name: string('Site name used in corpus headings.', ''),
      description: string('Site description used in corpora.', ''),
      defaultLocale: string('Default BCP 47 locale for pages that supply none.'),
      organization: {
        type: 'object',
        description: 'Explicit Schema.org organization entity or ID reference.',
        additionalProperties: true,
      },
      profile: object(profileProperties, 'Published site identity profile.'),
    },
    'Site identity and profile output.',
  ),
  pages: object(
    {
      include: stringArray('Path globs to include.', ['**']),
      exclude: stringArray('Path globs to exclude.', []),
      respectNoindex: boolean('Exclude pages marked noindex.', true),
      stripTitleSuffix,
      catalogs: {
        type: 'array',
        description: 'Importable page-catalog modules.',
        items: {
          ...object(
            {
              module: { type: 'string', minLength: 1, description: 'Importable module specifier.' },
            },
            'One catalog module.',
          ),
          required: ['module'],
        },
        default: [],
      },
    },
    'Page discovery and filtering.',
  ),
  markdown: object(markdownProperties, 'Markdown representation settings.'),
  corpus: object(
    {
      index: object(indexProperties, 'llms.txt settings.'),
      full: object(fullProperties, 'llms-full.txt settings.'),
      urlMap: object(urlMapProperties, 'URL-map settings.'),
      runtime: object(
        {
          maxPages: {
            description: 'Maximum pages rendered for one runtime corpus request.',
            anyOf: [{ type: 'integer', minimum: 1 }, { const: 'unlimited' }],
            default: 50,
          },
        },
        'Runtime corpus safety limits.',
      ),
    },
    'Corpus output settings.',
  ),
  discovery: object(
    {
      sitemap: object(
        {
          mode: {
            type: 'string',
            description: 'Sitemap integration ownership mode.',
            enum: ['auto', 'external', 'disabled'],
            default: 'auto',
          },
          options: {
            type: 'object',
            description: 'Options forwarded to @astrojs/sitemap.',
            additionalProperties: true,
            default: {},
          },
          alias: object(sitemapAliasProperties, 'Conventional sitemap alias settings.'),
        },
        'Sitemap integration settings.',
      ),
      robots: object(robotsProperties, 'robots.txt settings.'),
    },
    'Discovery artifact settings.',
  ),
  artifacts: object(
    {
      replace: {
        type: 'array',
        description: 'Exact normalized served pathnames that core artifacts may replace.',
        items: {
          type: 'string',
          pattern: '^(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)/(?!/)(?!.*[?#*{}\\[\\]\\\\]).*[^/]$',
        },
        uniqueItems: true,
        default: [],
      },
    },
    'Generated artifact ownership settings.',
  ),
  metadata: object(
    {
      fillMissing: boolean('Fill the supported set of absent metadata tags.', false),
      defaults: {
        ...object(
          {
            title: { type: 'string' },
            description: { type: 'string' },
            robots: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            openGraph: { type: 'object', additionalProperties: true },
            twitter: { type: 'object', additionalProperties: true },
            locale: { type: 'string' },
            themeColor: {},
            author: {},
          },
          'Explicit non-route-specific metadata defaults.',
        ),
        default: {},
      },
    },
    'Non-destructive metadata completion.',
  ),
  schema: object(
    {
      autoInject: boolean('Inject one Astro-AEO-managed graph on eligible pages.', true),
      infer: {
        type: 'array',
        items: { type: 'string', enum: ['website', 'webpage', 'breadcrumbs'] },
        uniqueItems: true,
        default: ['website', 'webpage', 'breadcrumbs'],
      },
      strictReferences: boolean('Treat unresolved same-document references as errors.', true),
      corpus: object(
        {
          enabled: boolean('Emit the experimental semantic corpus pair.', false),
          graphPath: string('App-relative graph corpus pathname.', '/schema/graph.jsonld'),
          mapPath: string('App-relative schema-map pathname.', '/schema/schema-map.xml'),
        },
        'Experimental non-standard semantic corpus output.',
      ),
    },
    'Schema.org graph generation and validation.',
  ),
  validation: object(
    {
      onBuild: {
        type: 'string', enum: ['artifacts', 'recommended', 'off'], default: 'artifacts',
      },
      failOn: { type: 'string', enum: ['error', 'warning'], default: 'error' },
    },
    'Build validation threshold.',
  ),
  plugins: {
    type: 'array',
    description: 'AstroAeoPlugin objects. setup is supplied as a function in JavaScript configuration.',
    items: {
      type: 'object',
      required: ['name', 'apiVersion'],
      properties: {
        name: { type: 'string', minLength: 1 },
        apiVersion: { const: 1 },
        runtime: {
          type: 'object',
          required: ['entrypoint'],
          properties: { entrypoint: { type: 'string', minLength: 1 }, options: {} },
          additionalProperties: false,
        },
      },
      additionalProperties: true,
    },
    default: [],
  },
};

const legacyProperties = {
  include: deprecated(stringArray('Path globs to include.', ['**']), 'pages.include'),
  exclude: deprecated(stringArray('Path globs to exclude.', []), 'pages.exclude'),
  respectNoindex: deprecated(boolean('Exclude pages marked noindex.', true), 'pages.respectNoindex'),
  stripTitleSuffix: deprecated(stripTitleSuffix, 'pages.stripTitleSuffix'),
  dotmd: deprecated(object(legacyDotmdProperties, 'Legacy Markdown settings.'), 'markdown'),
  llmsTxt: deprecated(
    object(
      {
        enabled: boolean('Generate /llms.txt.', true),
        sections: {
          type: 'array',
          description: 'Ordered llms.txt section rules. First match wins.',
          items: sectionRule,
          default: [{ title: 'Home', match: '/' }],
        },
        defaultSection: {
          description: 'Section for unmatched pages, or false to drop them.',
          anyOf: [{ type: 'string' }, { const: false }],
          default: 'Pages',
        },
        includeDescriptions: boolean('Include page descriptions.', true),
        showLastmod: deprecated(boolean('Show page modification dates.', false), 'corpus.index.showLastModified'),
        includeNoDotmd: deprecated(
          boolean('List pages without Markdown companions using their HTML URLs.', false),
          'corpus.index.includeHtmlOnly',
        ),
      },
      'Legacy llms.txt settings.',
    ),
    'corpus.index',
  ),
  llmsFullTxt: deprecated(object(fullProperties, 'Legacy llms-full.txt settings.'), 'corpus.full'),
  urlMap: deprecated(object(urlMapProperties, 'Legacy URL-map settings.'), 'corpus.urlMap'),
  robotsTxt: deprecated(object(robotsProperties, 'Legacy robots.txt settings.'), 'discovery.robots'),
  sitemap: deprecated(
    object(
      {
        enabled: boolean('Auto-register @astrojs/sitemap.', true),
        options: {
          type: 'object',
          description: 'Options forwarded to @astrojs/sitemap.',
          additionalProperties: true,
        },
      },
      'Legacy sitemap settings.',
    ),
    'discovery.sitemap',
  ),
  sitemapAlias: deprecated(
    object(sitemapAliasProperties, 'Legacy sitemap alias settings.'),
    'discovery.sitemap.alias',
  ),
  domainProfile: deprecated(object(legacyProfileProperties, 'Legacy domain profile settings.'), 'site.profile'),
};

export function buildSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://raw.githubusercontent.com/ZAAI-com/Astro-AEO/main/schema/astro-aeo.schema.json',
    title: 'Astro-AEO configuration',
    description:
      'Configuration passed to the astro-aeo integration. Canonical 1.2 settings and deprecated 1.0 aliases are accepted.',
    type: 'object',
    properties: { ...canonicalProperties, ...legacyProperties },
    additionalProperties: false,
  };
}

export function serializeSchema() {
  // The generator source is the human-readable definition. Keep the published
  // artifact compact so shipping editor support does not consume the package's
  // 10 percent size budget. Deprecated subtrees duplicate the canonical option
  // descriptions, so the artifact keeps their validation and `deprecated`
  // markers while the README remains the migration guidance.
  return `${JSON.stringify(buildPublishedSchema())}\n`;
}

function buildPublishedSchema() {
  const source = buildSchema();
  const canonicalNames = [
    'site', 'pages', 'markdown', 'corpus', 'discovery', 'artifacts', 'metadata',
    'schema', 'validation', 'plugins',
  ];
  const legacyNames = [
    'include',
    'exclude',
    'respectNoindex',
    'stripTitleSuffix',
    'dotmd',
    'llmsTxt',
    'llmsFullTxt',
    'urlMap',
    'robotsTxt',
    'sitemap',
    'sitemapAlias',
    'domainProfile',
  ];
  const properties = Object.fromEntries(
    canonicalNames.map((name) => [name, compactPublishedSchema(source.properties[name])]),
  );
  for (const name of legacyNames) {
    properties[name] = compactPublishedSchema(source.properties[name]);
  }

  // These legacy blocks have exactly the same validation shape as their
  // canonical targets. A reference keeps the deprecated marker without
  // publishing the same schema twice.
  properties.llmsFullTxt = legacyReference('#/properties/corpus/properties/full');
  properties.urlMap = legacyReference('#/properties/corpus/properties/urlMap');
  properties.robotsTxt = legacyReference('#/properties/discovery/properties/robots');
  properties.sitemapAlias = legacyReference(
    '#/properties/discovery/properties/sitemap/properties/alias',
  );
  // Renamed legacy blocks cannot reference their canonical object wholesale
  // because several child keys changed. Retain their exact accepted key sets
  // and unknown-key rejection, while canonical options carry the detailed value
  // schemas and editor documentation.
  for (const name of ['dotmd', 'llmsTxt', 'sitemap', 'domainProfile']) {
    properties[name] = compactLegacyObject(source.properties[name]);
  }

  return {
    $schema: source.$schema,
    title: source.title,
    type: source.type,
    properties,
    additionalProperties: false,
  };
}

function legacyReference($ref) {
  return { $ref, deprecated: true };
}

function compactLegacyObject(schema) {
  return {
    type: 'object',
    deprecated: true,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        compactPublishedSchema(child, true),
      ]),
    ),
    additionalProperties: false,
  };
}

function compactPublishedSchema(value, insideDeprecated = false, propertyMap = false) {
  if (Array.isArray(value)) {
    return value.map((item) => compactPublishedSchema(item, insideDeprecated));
  }
  if (typeof value !== 'object' || value === null) return value;

  const deprecatedTree = insideDeprecated || value.deprecated === true;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          propertyMap ||
          (key !== 'description' &&
            key !== 'default' &&
            !(insideDeprecated && key === 'deprecated')),
      )
      .map(([key, child]) => [
        key,
        compactPublishedSchema(child, deprecatedTree, key === 'properties'),
      ]),
  );
}
