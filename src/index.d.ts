import type { AstroIntegration } from 'astro';

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
  /** User-agents to allow ("User-agent: X" + "Allow: /"). */
  allow?: string[];
  /** User-agents to block ("User-agent: X" + "Disallow: /"). */
  disallow?: string[];
  /** Emit a "Sitemap:" line. Default: true. */
  includeSitemap?: boolean;
  /** Sitemap path appended to the site URL. Default: '/sitemap-index.xml'. */
  sitemapPath?: string;
  /** Emit a "# llms.txt:" comment line. Default: true. */
  includeLlmsTxt?: boolean;
  /** Extra verbatim lines appended to the end. */
  extraLines?: string[];
}

export interface DomainProfileOptions {
  /** Generate /.well-known/domain-profile.json. Default: false. */
  enabled?: boolean;
  name?: string;
  description?: string;
  /** Defaults to the Astro `site` URL. */
  website?: string;
  contact?: string;
  logo?: string;
  /** Related profile URLs (schema.org sameAs). */
  sameAs?: string[];
  /** schema.org @type. Default: 'Organization'. */
  entityType?: EntityType;
}

export interface AstroAeoConfig {
  /** Path globs of pages to include. Default: ['**']. */
  include?: string[];
  /** Path globs of pages to exclude. Default: []. */
  exclude?: string[];
  /** Skip pages carrying <meta name="robots" content="noindex">. Default: true. */
  respectNoindex?: boolean;
  /** Strip a trailing " | {suffix}" (or matching RegExp) from page titles. Default: false. */
  stripTitleSuffix?: string | string[] | RegExp | false;
  /** Site name/description for llms.txt headers. Falls back to domainProfile, then <title>, then hostname. */
  site?: { name?: string; description?: string };
  dotmd?: DotmdOptions;
  llmsTxt?: LlmsTxtOptions;
  llmsFullTxt?: LlmsFullTxtOptions;
  urlMap?: UrlMapOptions;
  robotsTxt?: RobotsTxtOptions;
  domainProfile?: DomainProfileOptions;
}

type DeepRequired<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends RegExp
      ? T
      : T extends object
        ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> }
        : T;

/** Fully-defaulted config produced by `resolveConfig` and consumed by generators. */
export type ResolvedAeoConfig = DeepRequired<AstroAeoConfig>;

/**
 * Answer Engine Optimization integration for Astro.
 *
 * Generates .md companion pages, llms.txt / llms-full.txt, robots.txt,
 * /.well-known/domain-profile.json and an optional URL map at build time,
 * and serves the text outputs live in `astro dev`.
 */
export default function aeo(config?: AstroAeoConfig): AstroIntegration;
