import type { AstroIntegration } from 'astro';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Diagnostic {
  version: 1;
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  pathname?: string;
  sourcePath?: string;
  details?: JsonValue;
}

export interface ExtractionDiagnostics {
  strategy: string;
  selectedNodes: number;
  inputCharacters: number;
  outputCharacters: number;
  removedNodes: number;
  fallbackReason?: string;
}

/**
 * A page as seen by section rules and match predicates.
 */
export interface AeoPage {
  /** Normalized pathname: leading slash, no trailing slash except root ("/"). */
  pathname: string;
  /** Absolute URL of the page. */
  url: string;
  /** Page title (with any configured suffix stripped). */
  title: string;
  /** Meta description, or empty string. */
  description: string;
}

/** Serializable page record shared by build, runtime, catalogs, and diagnostics. */
export interface AeoPageRecord extends AeoPage {
  rendering: 'prerendered' | 'on-demand';
  /** Root-relative, base-prefixed URL of the Markdown companion. */
  mdHref: string;
  markdown: string;
  /** ISO timestamp when known. */
  lastModified?: string;
  aeoTokens: string[];
  source?: {
    strategy: 'marker' | 'markdown-route' | 'rendered' | 'catalog';
    path?: string;
  };
  extraction?: ExtractionDiagnostics;
  diagnostics: Diagnostic[];
}

/**
 * A single llms.txt section. Pages are evaluated against `match` in array
 * order, first match wins. Empty sections are omitted from the output.
 */
export interface SectionRule {
  /** Heading rendered as "## {title}". */
  title: string;
  /**
   * Match a page to this section. Accepts:
   * - a glob string ("/", "/blog/**", "/20[0-9][0-9]/*")
   * - an array of glob strings (any match)
   * - a RegExp tested against the pathname
   * - a predicate receiving the page
   */
  match: string | string[] | RegExp | ((page: AeoPage) => boolean);
}

export type EntityType =
  | 'Organization'
  | 'Person'
  | 'Blog'
  | 'NGO'
  | 'Community'
  | 'Project'
  | 'CreativeWork'
  | 'SoftwareApplication'
  | 'Thing';

export interface DotmdOptions {
  /** Generate .md companion pages. Default: true. */
  enabled?: boolean;
  /**
   * Inject <link rel="alternate" type="text/markdown"> into each page's <head>.
   * - 'auto' (default): inject only if the page has no such link yet.
   * - 'always': replace any existing markdown-alternate link with the canonical one.
   * - 'never': do not touch the HTML.
   */
  linkTag?: 'auto' | 'always' | 'never';
  /** Append a "Last modified" line to .md files (from git or article:modified_time). Default: true. */
  includeLastModified?: boolean;
  /** Prepend YAML frontmatter (title, url, description, optional lastModified) to .md files. Default: false. */
  frontmatter?: boolean;
  /** @deprecated Renamed to `frontmatter`. Still honored with a warning. */
  dotmdMetadata?: boolean;
}

export interface LlmsTxtOptions {
  /** Generate /llms.txt. Default: true. */
  enabled?: boolean;
  /** Ordered section rules (first match wins). Default: a single "Pages" catch-all after "Home". */
  sections?: SectionRule[];
  /** Section title for pages matching no rule, or false to drop them. Default: 'Pages'. */
  defaultSection?: string | false;
  /** Append "{title}: {description}" when a description exists. Default: true. */
  includeDescriptions?: boolean;
  /** Append " _(updated YYYY-MM-DD)_" per entry. Default: false. */
  showLastmod?: boolean;
  /**
   * List pages that opt out of a .md companion (`<meta name="aeo" content="no-dotmd">`)
   * in llms.txt, linking to the HTML page instead of a `.md`. Default: false
   * (such pages are omitted, so llms.txt never links a missing `.md`).
   */
  includeNoDotmd?: boolean;
}

export interface LlmsFullTxtOptions {
  /** Generate /llms-full.txt. Default: true. */
  enabled?: boolean;
  /** Which pages to inline. Default: 'all'. */
  mode?: 'all' | 'index' | 'first-page-only';
}

export interface UrlMapOptions {
  /** Generate a URL map file. Default: false. */
  enabled?: boolean;
  /** Path relative to the project root. Default: 'docs/Url-Map.md'. */
  outputFilepath?: string;
}

export interface RobotsTxtOptions {
  /** Generate /robots.txt. Default: false. */
  enabled?: boolean;
  /**
   * Emit a leading "User-agent: *" + "Allow: /" group regardless of any named
   * allow/disallow groups, so unlisted crawlers see an explicit open policy.
   * Default: true. Suppressed automatically when "*" already appears in `allow`
   * or `disallow`, to avoid a duplicate wildcard group.
   */
  universalAllow?: boolean;
  /**
   * User-agents to allow ("User-agent: X" + "Allow: /"). Named groups no longer
   * suppress the universal "User-agent: *" group; that is controlled by
   * `universalAllow`.
   */
  allow?: string[];
  /**
   * User-agents to block ("User-agent: X" + "Disallow: /"). Named groups no
   * longer suppress the universal "User-agent: *" group; that is controlled by
   * `universalAllow`.
   */
  disallow?: string[];
  /**
   * Control the "Sitemap:" line. When omitted, Astro-AEO emits it only when the
   * configured sitemap path exists in the static build. Set true to force the
   * line for runtime-only sitemaps, or false to suppress it.
   */
  includeSitemap?: boolean;
  /**
   * Sitemap path appended to the site URL. Defaults to the `@astrojs/sitemap`
   * output name derived from `sitemap.options.filenameBase` (so '/sitemap-index.xml'
   * by default). Automatic robots mode verifies this path exists before emitting
   * the Sitemap line.
   */
  sitemapPath?: string;
  /** Emit a "# llms.txt:" comment line. Default: true. */
  includeLlmsTxt?: boolean;
  /** Extra verbatim lines appended to the end. */
  extraLines?: string[];
}

export interface SitemapOptions {
  /**
   * Generate a sitemap. Default: true. astro-aeo defers to the official
   * `@astrojs/sitemap` integration: when enabled and no sitemap is already
   * registered, it auto-adds `@astrojs/sitemap` (which requires Astro `site`).
   * This controls auto-registration only; user-registered sitemaps remain in use
   * when it is false.
   */
  enabled?: boolean;
  /**
   * Options forwarded verbatim to `@astrojs/sitemap` (e.g. `filter`,
   * `changefreq`, `priority`, `lastmod`, `i18n`, `entryLimit`). When a sitemap is
   * already registered by the user, other options are ignored but
   * `filenameBase` remains the shared output-name hint used by the alias and
   * robots defaults. Default: {}.
   */
  options?: Record<string, unknown>;
}

export interface SitemapAliasOptions {
  /**
   * Also emit a conventional /sitemap.xml by byte-copying the generated sitemap
   * index, so tools that probe that path get a 200 instead of a 404. Only mirrors
   * when the source exists, and never overwrites an existing target. Default: true.
   */
  enabled?: boolean;
  /**
   * The sitemap index filename to mirror. Default: derived from the
   * `@astrojs/sitemap` `filenameBase` (so 'sitemap-index.xml' by default).
   */
  sourceFilename?: string;
  /**
   * The conventional filename written at the build output root when that target
   * does not already exist. Default: 'sitemap.xml'.
   */
  outputFilename?: string;
}

export interface DomainProfileOptions {
  /** Generate /.well-known/domain-profile.json. Default: false. */
  enabled?: boolean;
  name?: string;
  description?: string;
  /** Defaults to the Astro `site` URL. */
  website?: string;
  /**
   * Primary contact, emitted into the schema.org profile by value shape: an
   * http(s) URL becomes a `contactPoint` (`{ '@type': 'ContactPoint', url }`),
   * a value containing "@" becomes `email`, and anything else becomes
   * `telephone`.
   */
  email?: string;
  /** @deprecated Renamed to `email`. Still honored with a warning. */
  contact?: string;
  logo?: string;
  /** Related profile URLs (schema.org sameAs). */
  sameAs?: string[];
  /** schema.org @type. Default: 'Organization'. */
  entityType?: EntityType;
}

export interface SitemapAliasCanonicalOptions {
  /**
   * Also emit a conventional /sitemap.xml by byte-copying the generated sitemap
   * index, so tools that probe that path get a 200 instead of a 404. Only mirrors
   * when the source exists, and never overwrites an existing build output. Default: true.
   */
  enabled?: boolean;
  /**
   * The sitemap index filename to mirror. Default: derived from the
   * `@astrojs/sitemap` `filenameBase` (so 'sitemap-index.xml' by default).
   */
  sourceFilename?: string;
  /**
   * The conventional filename written at the build output root when that target
   * does not already exist. Default: 'sitemap.xml'.
   */
  outputFilename?: string;
}

export interface DiscoverySitemapOptions {
  /**
   * How astro-aeo relates to `@astrojs/sitemap`. Default: 'auto'.
   * - 'auto': auto-register `@astrojs/sitemap` when none is present (requires Astro `site`).
   * - 'external': do not auto-register, but keep using a sitemap the project registers itself.
   * - 'disabled': no auto-registration, no alias, and no robots.txt Sitemap line.
   */
  mode?: 'auto' | 'external' | 'disabled';
  /**
   * Options forwarded verbatim to `@astrojs/sitemap` (e.g. `filter`, `changefreq`,
   * `priority`, `lastmod`, `i18n`, `entryLimit`). When a sitemap is already
   * registered by the project, other options are ignored but `filenameBase`
   * remains the shared output-name hint used by the alias and robots defaults.
   * Default: {}.
   */
  options?: Record<string, unknown>;
  alias?: SitemapAliasCanonicalOptions;
}

export interface DiscoveryRobotsOptions {
  /** Generate /robots.txt. Default: false. */
  enabled?: boolean;
  /**
   * Emit a leading "User-agent: *" + "Allow: /" group regardless of any named
   * allow/disallow groups, so unlisted crawlers see an explicit open policy.
   * Default: true. Suppressed automatically when "*" already appears in `allow`
   * or `disallow`, to avoid a duplicate wildcard group.
   */
  universalAllow?: boolean;
  /** User-agents to allow ("User-agent: X" + "Allow: /"). */
  allow?: string[];
  /** User-agents to block ("User-agent: X" + "Disallow: /"). */
  disallow?: string[];
  /**
   * Control the "Sitemap:" line. Omitted emits it only when the configured
   * sitemap path exists in the static build; true forces the line for
   * runtime-only sitemaps; false suppresses it.
   */
  includeSitemap?: boolean;
  /**
   * Sitemap path appended to the site URL. Defaults to the `@astrojs/sitemap`
   * output name derived from `discovery.sitemap.options.filenameBase`.
   */
  sitemapPath?: string;
  /** Emit a "# llms.txt:" comment line. Default: true. */
  includeLlmsTxt?: boolean;
  /** Extra verbatim lines appended to the end. */
  extraLines?: string[];
}

export interface DiscoveryOptions {
  sitemap?: DiscoverySitemapOptions;
  robots?: DiscoveryRobotsOptions;
}

/** How the robots.txt "Sitemap:" line is decided. Resolved from the optional tri-state. */
export type SitemapPolicy = 'auto' | 'always' | 'never';

export interface CorpusIndexOptions {
  /** Generate /llms.txt. Default: true. */
  enabled?: boolean;
  /** Ordered section rules (first match wins). Default: a single "Pages" catch-all after "Home". */
  sections?: SectionRule[];
  /** Section title for pages matching no rule, or false to drop them. Default: 'Pages'. */
  defaultSection?: string | false;
  /** Append "{title}: {description}" when a description exists. Default: true. */
  includeDescriptions?: boolean;
  /** Append " _(updated YYYY-MM-DD)_" per entry. Default: false. */
  showLastModified?: boolean;
  /**
   * List pages that opt out of a .md companion (`<meta name="aeo" content="no-dotmd">`),
   * linking to the HTML page instead of a `.md`. Default: false (such pages are
   * omitted, so llms.txt never links a missing `.md`).
   */
  includeHtmlOnly?: boolean;
}

export interface CorpusFullOptions {
  /** Generate /llms-full.txt. Default: true. */
  enabled?: boolean;
  /** Which pages to inline. Default: 'all'. */
  mode?: 'all' | 'index' | 'first-page-only';
}

export interface CorpusUrlMapOptions {
  /** Generate a URL map file. Default: false. */
  enabled?: boolean;
  /** Path relative to the project root. Default: 'docs/Url-Map.md'. */
  outputFilepath?: string;
}

export interface CorpusRuntimeOptions {
  /**
   * Maximum number of known pages rendered for a request-time corpus. Requests
   * above the limit fail with 503 instead of returning a partial corpus.
   * Default: 50. Use 'unlimited' only when the deployment can safely absorb the
   * self-fetch fan-out.
   */
  maxPages?: number | 'unlimited';
}

export interface CorpusOptions {
  /** The /llms.txt index. */
  index?: CorpusIndexOptions;
  /** The /llms-full.txt full-text corpus. */
  full?: CorpusFullOptions;
  /** A committed URL map, written to the project root rather than the build output. */
  urlMap?: CorpusUrlMapOptions;
  /** Safety limits for request-time llms.txt and llms-full.txt generation. */
  runtime?: CorpusRuntimeOptions;
}

export interface ExtractionOptions {
  /**
   * Content selectors, tried in order; the first with any match wins. Only
   * top-level matches are converted, so a nested match is not emitted twice.
   * Falls back to `<body>`. Default: ['article', 'main'].
   */
  selectors?: string[];
  /**
   * Dropped before conversion. `script`, `style`, `noscript`, `iframe`, and
   * `head` are always dropped in addition to these. Default: ['nav', 'footer'].
   */
  removeSelectors?: string[];
  /**
   * Preserved as raw HTML in the Markdown. Removal takes precedence, and the
   * always-dropped tags above can never be restored this way. Default: [].
   */
  keepSelectors?: string[];
}

export interface MarkdownOptions {
  /** Generate .md companion pages. Default: true. */
  enabled?: boolean;
  /**
   * Inject <link rel="alternate" type="text/markdown"> into each page's <head>.
   * - 'auto' (default): inject only if the page has no such link yet.
   * - 'always': replace any existing markdown-alternate link with the canonical one.
   * - 'never': do not touch the HTML.
   */
  alternateLink?: 'auto' | 'always' | 'never';
  /** Append a "Last modified" line to .md files (from git or article:modified_time). Default: true. */
  includeLastModified?: boolean;
  /** Prepend YAML frontmatter (title, url, description, optional lastModified) to .md files. Default: false. */
  frontmatter?: boolean;
  /**
   * Serve Markdown at a page's own URL when the client asks for it by `Accept`.
   * - 'off' (default): `.md` companions only, at their own paths.
   * - 'response': return Markdown at the original URL.
   * - 'redirect': redirect to the `.md` URL.
   *
   * Markdown must be requested explicitly and outrank HTML strictly; a wildcard,
   * a tie, or a malformed header always resolves to HTML.
   *
   * Applies to on-demand routes only. Astro does not expose request headers to a
   * prerendered route, so that code cannot appear to work in dev and then stop
   * once the page is a static file. A project with no adapter prerenders
   * everything and cannot negotiate anywhere; `.md` companions are unaffected.
   */
  negotiation?: 'off' | 'response' | 'redirect';
  /** Which part of a rendered page becomes Markdown. */
  extraction?: ExtractionOptions;
}

export interface PagesOptions {
  /** Path globs of pages to include. Default: ['**']. */
  include?: string[];
  /** Path globs of pages to exclude. Default: []. */
  exclude?: string[];
  /** Skip pages carrying <meta name="robots" content="noindex">. Default: true. */
  respectNoindex?: boolean;
  /** Strip a trailing " | {suffix}" (or matching RegExp) from page titles. Default: false. */
  stripTitleSuffix?: string | string[] | RegExp | false;
  /**
   * Modules listing pages the build cannot discover for itself, which is every
   * route generated from data rather than from a file. Each module default-exports
   * a `PageCatalog` (see `astro-aeo/page`). Without one, such a route is simply
   * absent from the corpus; astro-aeo does not crawl to find them. Default: [].
   */
  catalogs?: { module: string }[];
}

export interface ProfileOptions {
  /** Generate /.well-known/domain-profile.json. Default: false. */
  enabled?: boolean;
  name?: string;
  description?: string;
  /** Defaults to the Astro `site` URL. */
  website?: string;
  /**
   * Primary contact, emitted into the schema.org profile by value shape: an
   * http(s) URL becomes a `contactPoint` (`{ '@type': 'ContactPoint', url }`),
   * a value containing "@" becomes `email`, and anything else becomes
   * `telephone`.
   */
  email?: string;
  logo?: string;
  /** Related profile URLs (schema.org sameAs). */
  sameAs?: string[];
  /** schema.org @type. Default: 'Organization'. */
  entityType?: EntityType;
}

export interface SiteOptions {
  /** Site name for llms.txt headers. Falls back to the profile name, then <title>, then hostname. */
  name?: string;
  /** Site description for llms.txt headers. Falls back to the profile description. */
  description?: string;
  /** The published domain profile at /.well-known/domain-profile.json. */
  profile?: ProfileOptions;
}

/**
 * The canonical configuration surface.
 */
export interface CanonicalAeoConfig {
  site?: SiteOptions;
  pages?: PagesOptions;
  markdown?: MarkdownOptions;
  corpus?: CorpusOptions;
  discovery?: DiscoveryOptions;
}

/**
 * Options carried over from 1.0. Every one keeps working through 1.x, warns once
 * per section, and is removed in 2.0. Sections move here from `CanonicalAeoConfig`
 * one at a time as their canonical replacement lands.
 */
export interface LegacyAeoConfig {
  /** @deprecated Moved to `pages.include`. */
  include?: string[];
  /** @deprecated Moved to `pages.exclude`. */
  exclude?: string[];
  /** @deprecated Moved to `pages.respectNoindex`. */
  respectNoindex?: boolean;
  /** @deprecated Moved to `pages.stripTitleSuffix`. */
  stripTitleSuffix?: string | string[] | RegExp | false;
  /** @deprecated Moved to `markdown`. */
  dotmd?: DotmdOptions;
  /** @deprecated Moved to `corpus.index`. */
  llmsTxt?: LlmsTxtOptions;
  /** @deprecated Moved to `corpus.full`. */
  llmsFullTxt?: LlmsFullTxtOptions;
  /** @deprecated Moved to `corpus.urlMap`. */
  urlMap?: UrlMapOptions;
  /** @deprecated Moved to `discovery.robots`. */
  robotsTxt?: RobotsTxtOptions;
  /** @deprecated Moved to `discovery.sitemap`. `enabled: false` maps to `mode: 'external'`. */
  sitemap?: SitemapOptions;
  /** @deprecated Moved to `discovery.sitemap.alias`. */
  sitemapAlias?: SitemapAliasOptions;
  /** @deprecated Moved to `site.profile`. */
  domainProfile?: DomainProfileOptions;
}

export interface AstroAeoConfig extends CanonicalAeoConfig, LegacyAeoConfig {}

/**
 * Fully-defaulted config produced by `resolveConfig` and consumed by generators.
 *
 * Hand-written rather than derived from `AstroAeoConfig`. A derived
 * `DeepRequired<AstroAeoConfig>` cannot express a resolved-only field, cannot drop
 * the deprecated 1.0 tree while the public type keeps it, and collapses
 * `Record<string, unknown>` index signatures to `Record<string, {}>`.
 */
export interface ResolvedAstroAeoConfig {
  site: {
    name: string;
    description: string;
    profile: Required<ProfileOptions>;
  };
  pages: Required<PagesOptions>;
  markdown: Omit<Required<MarkdownOptions>, 'extraction'> & { extraction: Required<ExtractionOptions> };
  corpus: {
    index: Required<CorpusIndexOptions>;
    full: Required<CorpusFullOptions>;
    urlMap: Required<CorpusUrlMapOptions>;
    runtime: Required<CorpusRuntimeOptions>;
  };
  discovery: {
    sitemap: {
      mode: 'auto' | 'external' | 'disabled';
      options: Record<string, unknown>;
      alias: Required<SitemapAliasCanonicalOptions>;
    };
    robots: Required<DiscoveryRobotsOptions> & {
      /**
       * Resolved from the optional `includeSitemap` tri-state. Resolved-only: it
       * has no public counterpart, which is why the resolved config is
       * hand-written rather than derived from the public shape.
       */
      sitemapPolicy: SitemapPolicy;
    };
  };
}

/**
 * The 1.0 resolved shape.
 *
 * Deliberately unreachable: `resolveConfig` is not part of the package's `exports`
 * map, so no value of this type has ever been obtainable (the repo's own consumer
 * fixture has to `declare` one). It is kept only so downstream annotations that
 * name it still compile. Do not "fix" it by exporting a producer; do not widen it
 * as the canonical shape grows. Frozen: removed in 2.0.
 * @deprecated Renamed to `ResolvedAstroAeoConfig`.
 */
export interface ResolvedAeoConfig {
  include: string[];
  exclude: string[];
  respectNoindex: boolean;
  stripTitleSuffix: string | string[] | RegExp | false;
  site: { name: string; description: string };
  dotmd: Required<DotmdOptions>;
  llmsTxt: Required<LlmsTxtOptions>;
  llmsFullTxt: Required<LlmsFullTxtOptions>;
  urlMap: Required<UrlMapOptions>;
  robotsTxt: Required<RobotsTxtOptions>;
  domainProfile: Required<DomainProfileOptions>;
  sitemap: { enabled: boolean; options: Record<string, unknown> };
  sitemapAlias: Required<SitemapAliasOptions>;
}

/**
 * Answer Engine Optimization integration for Astro.
 *
 * Generates .md companion pages, llms.txt / llms-full.txt, robots.txt,
 * /.well-known/domain-profile.json and an optional URL map at build time,
 * and serves the text outputs live in `astro dev`.
 */
export default function aeo(config?: AstroAeoConfig): AstroIntegration;
