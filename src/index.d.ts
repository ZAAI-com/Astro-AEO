import type { AstroIntegration } from 'astro';
import type { AeoGraph, EntityReference, GraphInput, SchemaEntity } from './schema.js';

export type {
  AeoGraph,
  EntityId,
  EntityReference,
  GraphConflict,
  GraphConflictPolicy,
  GraphEntry,
  GraphEntryInput,
  GraphFinding,
  GraphInput,
  GraphMergeOptions,
  GraphProvenance,
  GraphProvenanceSource,
  GraphRole,
  GraphValidationOptions,
  GraphValidationResult,
  SchemaEntity,
  SchemaValidationResult,
} from './schema.js';
export type { CatalogContext, PageCatalog, PageDescriptor, PageSource } from './page.js';
export type { ExtractedDocument } from './extract.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PageAlternate {
  language: string | 'x-default';
  url: string;
}

export interface CacheDeclaration {
  pure: true;
  version: string;
}

export interface CorpusTokenizerModule {
  apiVersion: 1;
  name: string;
  version: string;
  approximate: boolean;
  count(text: string, options?: JsonValue): number | Promise<number>;
}

export interface CorpusManifestV1 {
  version: 1;
  origin: string;
  base: string;
  tokenizer: { name: string; version: string; approximate: boolean };
  locales: CorpusManifestLocaleV1[];
  pages: CorpusManifestPageV1[];
  artifacts: CorpusManifestArtifactV1[];
}

export interface CorpusManifestLocaleV1 {
  origin: string;
  locale: string | null;
  language: string | null;
  canonicalArtifact: string;
}

export interface CorpusManifestPageV1 {
  origin: string;
  id: string;
  canonicalUrl: string;
  markdownUrl: string;
  locale: string | null;
  language: string | null;
  section: string;
  tokenCount: number;
  hash: `sha256:${string}`;
  sourceStrategy: string;
  modified?: string;
  chunks: string[];
}

export interface CorpusManifestArtifactV1 {
  origin: string;
  pathname: string;
  kind: 'index' | 'full' | 'small' | 'chunk' | 'alias';
  locale: string | null;
  section: string | null;
  part: number | null;
  tokenCount: number;
  hash: `sha256:${string}`;
  encoding: 'identity' | 'gzip';
  sourcePathname: string | null;
}

export interface IndexNowStateManifestV1 {
  version: 1;
  origin: string;
  current: {
    digest: `sha256:${string}`;
    urls: Array<{ url: string; fingerprint: `sha256:${string}` }>;
  };
  acknowledged: {
    digest: `sha256:${string}`;
    urls: Array<{ url: string; fingerprint: `sha256:${string}` }>;
  };
  digest: `sha256:${string}`;
}

export interface Diagnostic {
  version: 1;
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  pathname?: string;
  sourcePath?: string;
  details?: JsonValue;
}

export interface DiagnosticManifestPageV1 {
  pathname: string;
  /** Sanitized source strategy only. Source bodies never enter this manifest. */
  source?: string;
  sourcePath?: string;
  extraction?: ExtractionDiagnostics;
  diagnostics: Diagnostic[];
}

export interface DiagnosticManifestV1 {
  version: 1;
  generatedAt: string;
  pages: DiagnosticManifestPageV1[];
  diagnostics: Diagnostic[];
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
  /** Stable route identity. In 1.2 this is the normalized app-relative pathname. */
  id: string;
  routePattern?: string;
  rendering: 'prerendered' | 'on-demand';
  canonicalUrl?: string;
  markdownUrl?: string;
  origin?: string;
  locale?: string;
  language?: string;
  alternates?: PageAlternate[];
  metadata: {
    title: string;
    description?: string;
    image?: string;
    canonicalSource?: 'authored' | 'inferred';
  };
  representations: {
    html?: string;
    markdown?: string;
    plainText?: string;
  };
  dates?: { published?: string; modified?: string };
  authors: EntityReference[];
  entities: SchemaEntity[];
  directives: {
    index: boolean;
    includeInLlms: boolean;
    includeInLlmsFull: boolean;
    generateMarkdown: boolean;
  };
  /** Root-relative, base-prefixed URL of the Markdown companion. */
  mdHref: string;
  markdown: string;
  /** ISO timestamp when known. */
  lastModified?: string;
  aeoTokens: string[];
  source?: {
    kind: 'markdown' | 'mdx' | 'astro' | 'cms' | 'rendered' | 'custom';
    /** @deprecated Compatibility mirror retained through 1.x. */
    strategy?: 'marker' | 'markdown-route' | 'rendered' | 'catalog';
    path?: string;
    body?: string;
    hash?: string;
  };
  extraction?: ExtractionDiagnostics;
  diagnostics: Diagnostic[];
}

export interface Representation {
  readonly body: string;
  readonly contentType: string;
}

export interface Artifact {
  /** Browser-visible pathname, including Astro's configured base. */
  readonly pathname: string;
  readonly representation: Representation;
  /** Plugin claims only: authorize replacing external ownership at this exact path. */
  readonly replace?: boolean;
}

export type GeneratedArtifactOwner =
  | { readonly kind: 'core'; readonly name: string }
  | { readonly kind: 'plugin'; readonly name: string; readonly claimId?: string };

export type ExternalArtifactOwner =
  | { readonly kind: 'project-route'; readonly rendering: 'prerendered' | 'on-demand'; readonly routePattern?: string }
  | { readonly kind: 'integration-route'; readonly name?: string }
  | { readonly kind: 'public-file' }
  | { readonly kind: 'existing-output' };

export type ArtifactOwner = GeneratedArtifactOwner | ExternalArtifactOwner;

export interface ArtifactRepresentationManifestV1 {
  contentType: string;
  byteLength: number;
  etag: string;
}

export interface ArtifactClaimantManifestV1 {
  owner: GeneratedArtifactOwner;
  count: number;
}

export type ArtifactOwnershipManifestEntryV1 =
  | {
      pathname: string;
      status: 'runtime';
      owner: GeneratedArtifactOwner;
      replacedOwners?: ExternalArtifactOwner[];
      group?: string;
    }
  | {
      pathname: string;
      status: 'emitted';
      owner: GeneratedArtifactOwner;
      outputPath: string;
      representation: ArtifactRepresentationManifestV1;
      replacedOwners?: ExternalArtifactOwner[];
      group?: string;
    }
  | {
      pathname: string;
      status: 'preserved';
      owner: GeneratedArtifactOwner;
      blockingOwners: ExternalArtifactOwner[];
      group?: string;
    }
  | {
      pathname: string;
      status: 'conflict';
      claimants: ArtifactClaimantManifestV1[];
      group?: string;
    }
  | {
      pathname: string;
      status: 'group-skipped';
      owner: GeneratedArtifactOwner;
      group: string;
      causedBy: string[];
    };

export interface ArtifactOwnershipManifestV1 {
  version: 1;
  generatedAt: string;
  base: string;
  outputRootId: string;
  artifacts: ArtifactOwnershipManifestEntryV1[];
  groups: { id: string; mode: 'all-or-none'; pathnames: string[]; status: 'emitted' | 'skipped' }[];
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
  /** Crawler policy preset. `custom` preserves the 1.2 renderer. Default: `custom`. */
  policy?: 'custom' | 'open' | 'search-open-training-closed' | 'retrieval-only' | 'closed';
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
  /** Experimental Content Signals. All three fields must be supplied together. */
  contentSignals?: ContentSignalsOptions;
}

export interface ContentSignalsOptions {
  search: boolean;
  aiInput: boolean;
  aiTrain: boolean;
}

export type IndexNowKeySource =
  | { source: 'env'; name?: string }
  | { source: 'file'; path: string };

export interface IndexNowOriginOptions {
  origin: string;
  key?: IndexNowKeySource;
  keyLocation?: string;
}

export interface DiscoveryIndexNowOptions {
  enabled?: boolean;
  /** Submit changed URLs or every current URL. Default: `changed`. */
  submit?: 'changed' | 'all';
  /** Persistence and removal-notification strategy. Default: `public`. */
  state?: 'public' | 'private' | 'stateless';
  /** Exit unsuccessfully for remote submission failures. Default: false. */
  strict?: boolean;
  /** Secret descriptor. Literal key values are never accepted. */
  key?: IndexNowKeySource;
  /** Root-relative same-origin key pathname. Defaults to `/<key>.txt`. */
  keyLocation?: string;
  /** Per-origin key and key-location overrides. */
  origins?: IndexNowOriginOptions[];
}

export interface DiscoveryOptions {
  sitemap?: DiscoverySitemapOptions;
  robots?: DiscoveryRobotsOptions;
  indexNow?: DiscoveryIndexNowOptions;
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

export interface CorpusSmallOptions {
  /** Generate llms-small.txt. Default: false. */
  enabled?: boolean;
  /** Maximum exact planned token count. Default: 20,000. */
  maxTokens?: number;
}

export interface CorpusChunksOptions {
  /** Generate bounded corpus chunks. Default: false. */
  enabled?: boolean;
  /** Maximum planned tokens in a chunk, except indivisible oversized units. Default: 100,000. */
  maxTokensPerFile?: number;
  /** Chunk grouping strategy. The 1.3 value is `section`. */
  by?: 'section';
}

export interface CorpusManifestOptions {
  /** Generate /llms/manifest.json. Default: false. */
  enabled?: boolean;
}

export interface CorpusTokenizerOptions {
  /** Local importable module that default-exports `CorpusTokenizerModule`. */
  module: string | URL;
  options?: JsonValue;
}

export interface CorpusCompressionOptions {
  /** Generate deterministic static `.gz` siblings for corpus text artifacts. Default: false. */
  gzip?: boolean;
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
   * serial in-process renders.
   */
  maxPages?: number | 'unlimited';
}

export interface CorpusOptions {
  /** The /llms.txt index. */
  index?: CorpusIndexOptions;
  /** The /llms-full.txt full-text corpus. */
  full?: CorpusFullOptions;
  /** A token-budgeted prefix corpus. */
  small?: CorpusSmallOptions;
  /** Bounded per-section corpus chunks. */
  chunks?: CorpusChunksOptions;
  /** Stable corpus inventory and exact-byte hashes. */
  manifest?: CorpusManifestOptions;
  /** Optional custom tokenizer module. */
  tokenizer?: CorpusTokenizerOptions;
  /** Static corpus compression settings. */
  compression?: CorpusCompressionOptions;
  /** A committed URL map, written to the project root rather than the build output. */
  urlMap?: CorpusUrlMapOptions;
  /** Safety limits for request-time llms.txt and llms-full.txt generation. */
  runtime?: CorpusRuntimeOptions;
}

export interface I18nOptions {
  /** Placement of global and locale corpus families. Default: `auto`. */
  indexes?: 'auto' | 'global' | 'locale' | 'both';
  /** Policy for pages whose language cannot be resolved. Default: `default`. */
  unresolvedLanguage?: 'default' | 'error' | 'exclude';
}

export interface CacheOptions {
  /** Reuse content-addressed page-processing payloads. Default: true. */
  enabled?: boolean;
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

export interface MarkdownRendererDescriptor {
  module: string | URL;
  options?: JsonValue;
}

export interface RendererDiagnostic {
  code: string;
  severity?: 'info' | 'warning' | 'error';
  message: string;
}

export interface MarkdownRendererInput {
  readonly pathname: string;
  readonly routePattern?: string;
  readonly rendering: 'prerendered' | 'on-demand';
  readonly canonicalUrl?: string;
  readonly source?: import('./page.js').PageSource;
  /** Already-rendered local HTML. Astro-AEO never fetches it. */
  readonly html: string;
  /** DOM extraction options used by the rendered-HTML fallback. */
  readonly extraction: ExtractionOptions;
  readonly options?: JsonValue;
}

export type MarkdownRendererResult =
  | { status: 'rendered'; markdown: string; diagnostics?: readonly RendererDiagnostic[] }
  | { status: 'decline' }
  | { status: 'continue'; diagnostics: readonly RendererDiagnostic[] }
  | { status: 'fallback-to-html'; diagnostics?: readonly RendererDiagnostic[] };

export type MarkdownRenderer = (
  input: Readonly<MarkdownRendererInput>,
) => MarkdownRendererResult | Promise<MarkdownRendererResult>;

export interface MarkdownRendererModule {
  readonly name: string;
  readonly apiVersion: 1;
  readonly cache?: CacheDeclaration;
  readonly render: MarkdownRenderer;
}

export type MarkdownRendererConfig = MarkdownRendererDescriptor | MarkdownRenderer;

export interface MarkdownOptions {
  /** Generate .md companion pages. Default: true. */
  enabled?: boolean;
  /** Shared source resolution strategy. The only 1.2 value is `auto`. */
  strategy?: 'auto';
  /** Importable renderers, or build-only inline renderer functions. */
  renderers?: MarkdownRendererConfig[];
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
   * Enumerate prerendered dynamic routes in development corpora.
   * - `'startup'` (default): discover route files known when `astro dev` starts.
   *   Existing modules and their content dependencies remain hot, but adding or deleting
   *   a route file requires a restart.
   * - `'hot'`: also track route-file additions and removals. This mode is experimental
   *   because it relies on Astro private route APIs.
   * - `false`: use only concrete routes and configured catalogs in development.
   *
   * Discovery lazily invokes each page's own `getStaticPaths()` only for aggregate live
   * corpora. Astro-AEO never crawls or parses content directories. Returned props are
   * discarded. Keep `getStaticPaths()` deterministic and safe to evaluate during a corpus
   * request. Catalogs take precedence when they describe an automatically discovered path.
   */
  devDynamicDiscovery?: 'startup' | 'hot' | false;
  /**
   * Modules listing pages that cannot be enumerated from static build output or from
   * prerendered development `getStaticPaths()` calls. Catalogs remain necessary for
   * on-demand or SSR, CMS-only, and synthetic routes. They can also overlay concrete or
   * automatically discovered paths with exact authored source and metadata. Entrypoints
   * must be Node-loadable JavaScript (`.js`, `.mjs`, or `.cjs`); compile TypeScript catalog
   * sources before configuring them here. Default: [].
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
  /** Default BCP 47 locale used only when the page supplies none. */
  defaultLocale?: string;
  /** Explicit organization facts. Astro-AEO never invents organization data. */
  organization?: SchemaEntity | EntityReference;
  /** The published domain profile at /.well-known/domain-profile.json. */
  profile?: ProfileOptions;
}

export interface ArtifactsOptions {
  /** Exact normalized served pathnames that core generators may replace. No globs. */
  replace?: string[];
}

export interface MetadataDefaults {
  title?: string;
  description?: string;
  robots?: string | string[];
  openGraph?: JsonValue;
  twitter?: JsonValue;
  locale?: string;
  themeColor?: string | JsonValue;
  author?: string | JsonValue;
}

export interface MetadataOptions {
  /** Fill the small supported set of absent metadata fields. Default: false. */
  fillMissing?: boolean;
  defaults?: MetadataDefaults;
}

export type SchemaInference = 'website' | 'webpage' | 'breadcrumbs';

export interface SchemaCorpusOptions {
  enabled?: boolean;
  graphPath?: string;
  mapPath?: string;
}

export interface SchemaOptions {
  /** Inject one managed graph on eligible pages. Default: true. */
  autoInject?: boolean;
  infer?: SchemaInference[];
  strictReferences?: boolean;
  corpus?: SchemaCorpusOptions;
}

export interface ValidationOptions {
  onBuild?: 'artifacts' | 'recommended' | 'off';
  failOn?: 'error' | 'warning';
}

export type AstroAeoPluginStage =
  | 'page:discovered'
  | 'page:extract'
  | 'page:transform'
  | 'page:metadata'
  | 'graph:build'
  | 'artifact:generate'
  | 'artifact:validate'
  | 'build:complete';

export interface PluginDiagnostic {
  code: string;
  severity?: 'info' | 'warning' | 'error';
  message: string;
  recoverable?: boolean;
}

export type AstroAeoPluginHookResult<T> =
  | void
  | { action: 'keep'; diagnostics?: readonly PluginDiagnostic[] }
  | { action: 'replace'; value: T; diagnostics?: readonly PluginDiagnostic[] }
  | { action: 'isolate'; diagnostics?: readonly PluginDiagnostic[] };

/** Recursive readonly view used for values crossing a plugin hook boundary. */
export type ImmutablePluginValue<T> =
  T extends (...args: any[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? readonly ImmutablePluginValue<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: ImmutablePluginValue<T[Key]> }
        : T;

/** Sanitized page data available through a runtime plugin's lazy page handle. */
export interface RuntimePluginPageRecord {
  readonly id: string;
  readonly pathname: string;
  readonly origin?: string;
  readonly locale?: string;
  readonly routePattern?: string;
  readonly rendering?: 'prerendered' | 'on-demand';
  readonly canonicalUrl?: string;
  readonly markdownUrl?: string;
  readonly language?: string;
  readonly alternates?: readonly ImmutablePluginValue<PageAlternate>[];
  readonly metadata?: ImmutablePluginValue<AeoPageRecord['metadata']>;
  readonly representations: {
    readonly markdown?: string;
    readonly plainText?: string;
  };
  readonly dates?: ImmutablePluginValue<NonNullable<AeoPageRecord['dates']>>;
  readonly authors?: readonly EntityReference[];
  readonly entities?: readonly SchemaEntity[];
  readonly directives?: ImmutablePluginValue<AeoPageRecord['directives']>;
  readonly extraction?: ImmutablePluginValue<ExtractionDiagnostics>;
}

export interface RuntimePluginPageHandle {
  readonly id: string;
  readonly pathname: string;
  readonly origin?: string;
  readonly locale?: string;
  readonly alternates?: readonly ImmutablePluginValue<PageAlternate>[];
  read(): Promise<RuntimePluginPageRecord | null>;
}

export interface AstroAeoPluginHookInput<T> {
  readonly value: ImmutablePluginValue<T>;
  readonly pathname?: string;
  readonly mode: 'build' | 'runtime';
  /** Present only for runtime hooks and confined to pages Astro-AEO already enumerated. */
  readonly pages?: readonly RuntimePluginPageHandle[];
}

export type AstroAeoPluginHook<T = unknown> = (
  input: Readonly<AstroAeoPluginHookInput<T>>,
) => AstroAeoPluginHookResult<T> | Promise<AstroAeoPluginHookResult<T>>;

export interface PluginArtifactClaim {
  id: string;
  pathname: string;
  replace?: boolean;
}

export interface AstroAeoPluginApi {
  readonly command: 'dev' | 'build' | 'preview';
  /** Present only in an importable runtime module, after strict JSON validation. */
  readonly options?: JsonValue;
  on<T>(stage: AstroAeoPluginStage, hook: AstroAeoPluginHook<T>): void;
  on<T>(
    stage: 'page:discovered' | 'page:extract' | 'page:transform' | 'page:metadata' | 'graph:build',
    hook: AstroAeoPluginHook<T>,
    options: { cache?: CacheDeclaration },
  ): void;
  claimArtifact(claim: PluginArtifactClaim): void;
}

export interface AstroAeoPlugin {
  name: string;
  apiVersion: 1;
  setup(api: AstroAeoPluginApi): void;
  runtime?: {
    entrypoint: string | URL;
    options?: JsonValue;
  };
}

/**
 * The canonical configuration surface.
 */
export interface CanonicalAeoConfig {
  site?: SiteOptions;
  pages?: PagesOptions;
  markdown?: MarkdownOptions;
  corpus?: CorpusOptions;
  i18n?: I18nOptions;
  cache?: CacheOptions;
  discovery?: DiscoveryOptions;
  artifacts?: ArtifactsOptions;
  metadata?: MetadataOptions;
  schema?: SchemaOptions;
  validation?: ValidationOptions;
  plugins?: AstroAeoPlugin[];
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
    defaultLocale: string | undefined;
    organization: SchemaEntity | EntityReference | undefined;
    profile: Required<ProfileOptions>;
  };
  pages: Required<PagesOptions>;
  markdown: Omit<Required<MarkdownOptions>, 'extraction'> & { extraction: Required<ExtractionOptions> };
  artifacts: { replace: string[] };
  metadata: { fillMissing: boolean; defaults: MetadataDefaults };
  schema: {
    autoInject: boolean;
    infer: SchemaInference[];
    strictReferences: boolean;
    corpus: Required<SchemaCorpusOptions>;
  };
  validation: Required<ValidationOptions>;
  plugins: AstroAeoPlugin[];
  i18n: Required<I18nOptions>;
  cache: Required<CacheOptions>;
  corpus: {
    index: Required<CorpusIndexOptions>;
    full: Required<CorpusFullOptions>;
    small: Required<CorpusSmallOptions>;
    chunks: Required<CorpusChunksOptions>;
    manifest: Required<CorpusManifestOptions>;
    tokenizer: CorpusTokenizerOptions | undefined;
    compression: Required<CorpusCompressionOptions>;
    urlMap: Required<CorpusUrlMapOptions>;
    runtime: Required<CorpusRuntimeOptions>;
  };
  discovery: {
    sitemap: {
      mode: 'auto' | 'external' | 'disabled';
      options: Record<string, unknown>;
      alias: Required<SitemapAliasCanonicalOptions>;
    };
    robots: Omit<Required<DiscoveryRobotsOptions>, 'contentSignals'> & {
      contentSignals?: ContentSignalsOptions;
      /**
       * Resolved from the optional `includeSitemap` tri-state. Resolved-only: it
       * has no public counterpart, which is why the resolved config is
       * hand-written rather than derived from the public shape.
       */
      sitemapPolicy: SitemapPolicy;
    };
    indexNow: ResolvedIndexNowOptions;
  };
}

export interface ResolvedIndexNowOptions {
  enabled: boolean;
  submit: 'changed' | 'all';
  state: 'public' | 'private' | 'stateless';
  strict: boolean;
  key: { source: 'env'; name: string } | { source: 'file'; path: string };
  keyLocation: string | undefined;
  origins: Array<{
    origin: string;
    key?: { source: 'env'; name: string } | { source: 'file'; path: string };
    keyLocation?: string;
  }>;
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
