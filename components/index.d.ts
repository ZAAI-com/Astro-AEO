import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { GraphInput } from '../src/schema.js';

type AstroComponentWithProps<Props> = AstroComponentFactory & ((props: Props) => any);

export type AeoHeadUrl = string | URL;

export interface AeoOpenGraphImage {
  url: AeoHeadUrl;
  secureUrl?: AeoHeadUrl;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface AeoOpenGraphMetadata {
  type?: string;
  title?: string;
  description?: string;
  url?: AeoHeadUrl;
  siteName?: string;
  images?: AeoHeadUrl | AeoOpenGraphImage | readonly (AeoHeadUrl | AeoOpenGraphImage)[];
  localeAlternates?: readonly string[];
}

export interface AeoTwitterMetadata {
  card: 'summary' | 'summary_large_image' | 'player' | 'app';
  site?: string;
  siteId?: string;
  creator?: string;
  creatorId?: string;
  title?: string;
  description?: string;
  image?: AeoHeadUrl;
  imageAlt?: string;
  player?: { url: AeoHeadUrl; width: number; height: number; stream?: AeoHeadUrl };
  apps?: readonly { platform: 'iphone' | 'ipad' | 'googleplay'; name: string; id: string; url?: AeoHeadUrl }[];
}

export interface AeoHeadProps {
  title?: string;
  description?: string;
  canonical?: AeoHeadUrl;
  robots?: string | readonly string[];
  openGraph?: AeoOpenGraphMetadata;
  twitter?: AeoTwitterMetadata;
  locale?: string;
  hreflang?: readonly { lang: string; href: AeoHeadUrl }[];
  feeds?: readonly { href: AeoHeadUrl; type: string; title?: string }[];
  pagination?: { previous?: AeoHeadUrl; next?: AeoHeadUrl };
  markdownAlternate?: AeoHeadUrl | { href: AeoHeadUrl; title?: string };
  themeColor?: string | { color: string; media?: string } | readonly { color: string; media?: string }[];
  /** Preferred plural spelling. */
  authors?: string | { name: string; url?: AeoHeadUrl } | readonly (string | { name: string; url?: AeoHeadUrl })[];
  /** @deprecated Use `authors`; retained through 1.x. */
  author?: string | { name: string; url?: AeoHeadUrl } | readonly (string | { name: string; url?: AeoHeadUrl })[];
  graph?: GraphInput;
  /** Undefined inherits schema.infer; false disables inference for this page. */
  infer?: false | readonly ('website' | 'webpage' | 'breadcrumbs')[];
}

export declare const AeoHead: AstroComponentWithProps<AeoHeadProps>;

export interface FaqItem {
  question: string;
  answer: string;
}
export interface FaqJsonLdProps {
  items: FaqItem[];
}
export declare const FaqJsonLd: AstroComponentFactory;

export interface HowToStep {
  name: string;
  text: string;
  url?: string;
  image?: string;
}
export interface HowToJsonLdProps {
  name: string;
  description?: string;
  /** ISO 8601 duration, e.g. "PT5M". */
  totalTime?: string;
  steps: HowToStep[];
}
export declare const HowToJsonLd: AstroComponentFactory;

export interface Crumb {
  name: string;
  url: string;
}
export interface BreadcrumbJsonLdProps {
  /** Explicit trail. Omit to auto-derive from the current URL. */
  items?: Crumb[];
  /** Override the humanized label for a given path segment. */
  labels?: Record<string, string>;
  /** Include the leading Home crumb. Default: true. */
  includeHome?: boolean;
}
export declare const BreadcrumbJsonLd: AstroComponentFactory;

export interface OrganizationJsonLdProps {
  name: string;
  /** Defaults to the Astro `site` URL. */
  url?: string;
  logo?: string;
  sameAs?: string[];
  contactEmail?: string;
}
export declare const OrganizationJsonLd: AstroComponentFactory;

export interface SpeakableJsonLdProps {
  /** CSS selectors for the speakable regions. Default: ['main']. */
  cssSelector?: string | string[];
  /** Canonical URL. Defaults to the current page URL against `site`. */
  url?: string;
}
export declare const SpeakableJsonLd: AstroComponentFactory;

export interface ArticleAuthor {
  name: string;
  url?: string;
}
export interface ArticleJsonLdProps {
  headline: string;
  datePublished?: string;
  dateModified?: string;
  author?: ArticleAuthor;
  image?: string;
  description?: string;
  url?: string;
}
export declare const ArticleJsonLd: AstroComponentFactory;

/**
 * Props for the `AeoPage` marker component. Every field is optional: supplying
 * none is the same as not rendering it. Build one with `defineAeoPage` from
 * `astro-aeo/page` rather than by hand.
 *
 * Note the name is shared with the `AeoPage` *type* exported from `astro-aeo`,
 * which is the page shape passed to section-rule predicates. They are different
 * modules; alias one if you import both in a single file.
 */
export interface AeoPageProps {
  /** Authored Markdown, used instead of extracting from the rendered HTML. */
  markdown?: string;
  title?: string;
  description?: string;
  image?: string;
  language?: string;
  /** ISO date. */
  published?: string;
  /** ISO date. */
  lastModified?: string;
  /** Where the content came from, recorded in diagnostics. */
  sourcePath?: string;
  sourceKind?: 'markdown' | 'mdx' | 'astro' | 'cms' | 'rendered' | 'custom';
  authors?: import('../src/schema.js').EntityReference[];
  entities?: import('../src/schema.js').SchemaEntity[];
  directives?: Partial<{
    index: boolean;
    includeInLlms: boolean;
    includeInLlmsFull: boolean;
    generateMarkdown: boolean;
  }>;
}
export declare const AeoPage: AstroComponentFactory;
