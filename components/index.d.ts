import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { GraphInput, SchemaBuilderInput, ExactSchemaType, EntityReference } from '../src/schema.js';
import type { Product, SoftwareApplication, Review, ItemList, Dataset, ProfilePage, Service, LocalBusiness, Organization, ImageObject } from 'schema-dts';

type AstroComponentWithProps<Props> = AstroComponentFactory & ((props: Props) => any);

/** Selects checks only, not a guarantee of Google eligibility. Default: schema. */
export type SchemaEligibility = 'schema' | 'google';
export interface SchemaEligibilityProps { eligibility?: SchemaEligibility }
export interface ProductJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<Product, 'Product'>> }
export interface SoftwareApplicationJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<SoftwareApplication, 'SoftwareApplication'>> }
export interface ReviewJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<Review, 'Review'>> }
export interface ItemListJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<ItemList, 'ItemList'>> }
export interface DatasetJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<Dataset, 'Dataset'>> }
export interface ProfilePageJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<ProfilePage, 'ProfilePage'>> }
export interface ServiceJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<Service, 'Service'>> }
export interface LocalBusinessJsonLdProps extends SchemaEligibilityProps { entity: SchemaBuilderInput<ExactSchemaType<LocalBusiness, 'LocalBusiness'>> }
export declare const ProductJsonLd: AstroComponentWithProps<ProductJsonLdProps>;
export declare const SoftwareApplicationJsonLd: AstroComponentWithProps<SoftwareApplicationJsonLdProps>;
export declare const ReviewJsonLd: AstroComponentWithProps<ReviewJsonLdProps>;
export declare const ItemListJsonLd: AstroComponentWithProps<ItemListJsonLdProps>;
export declare const DatasetJsonLd: AstroComponentWithProps<DatasetJsonLdProps>;
export declare const ProfilePageJsonLd: AstroComponentWithProps<ProfilePageJsonLdProps>;
export declare const ServiceJsonLd: AstroComponentWithProps<ServiceJsonLdProps>;
export declare const LocalBusinessJsonLd: AstroComponentWithProps<LocalBusinessJsonLdProps>;

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
export interface FaqJsonLdProps extends SchemaEligibilityProps {
  items: FaqItem[];
  /**
   * Stable `@id` for the FAQPage, so the schema graph and map can list it instead
   * of reporting an anonymous entity. A page-relative value such as `'#faq'`
   * resolves against the page URL on the configured `site`. A value that does not
   * parse, or that resolves to the page URL itself, is omitted. Default: none.
   */
  id?: string;
}
export declare const FaqJsonLd: AstroComponentWithProps<FaqJsonLdProps>;

export interface HowToStep {
  name: string;
  text: string;
  url?: string;
  image?: string;
}
export interface HowToJsonLdProps extends SchemaEligibilityProps {
  name: string;
  description?: string;
  /** ISO 8601 duration, e.g. "PT5M". */
  totalTime?: string;
  steps: HowToStep[];
}
export declare const HowToJsonLd: AstroComponentWithProps<HowToJsonLdProps>;

export interface Crumb {
  name: string;
  url: string;
}
export interface BreadcrumbJsonLdProps extends SchemaEligibilityProps {
  /** Explicit trail. Omit to auto-derive from the current URL. */
  items?: Crumb[];
  /** Override the humanized label for a given path segment. */
  labels?: Record<string, string>;
  /** Include the leading Home crumb. Default: true. */
  includeHome?: boolean;
}
export declare const BreadcrumbJsonLd: AstroComponentWithProps<BreadcrumbJsonLdProps>;

export interface OrganizationJsonLdProps extends SchemaEligibilityProps {
  name: string;
  /** Defaults to the Astro `site` URL. */
  url?: string;
  logo?: string;
  sameAs?: string[];
  contactEmail?: string;
}
export declare const OrganizationJsonLd: AstroComponentWithProps<OrganizationJsonLdProps>;

export interface SpeakableJsonLdProps extends SchemaEligibilityProps {
  /** CSS selectors for the speakable regions. Default: ['main']. */
  cssSelector?: string | string[];
  /** Canonical URL. Defaults to the current page URL against `site`. */
  url?: string;
}
export declare const SpeakableJsonLd: AstroComponentWithProps<SpeakableJsonLdProps>;

export interface ArticleAuthor {
  name: string;
  url?: string;
  '@type'?: 'Person' | 'Organization';
  '@id'?: string;
  sameAs?: string | readonly string[];
}
export interface ArticleJsonLdProps extends SchemaEligibilityProps {
  headline: string;
  type?: 'Article' | 'BlogPosting' | 'TechArticle';
  /**
   * Google prefers an ISO 8601 datetime with an offset or `Z`. Bare Schema.org dates remain valid
   * but may trigger non-critical Rich Results warnings. Astro-AEO passes the value through unchanged
   * without normalization.
   */
  datePublished?: string;
  /**
   * Google prefers an ISO 8601 datetime with an offset or `Z`. Bare Schema.org dates remain valid
   * but may trigger non-critical Rich Results warnings. Astro-AEO passes the value through unchanged
   * without normalization.
   */
  dateModified?: string;
  author?: ArticleAuthor | EntityReference | readonly (ArticleAuthor | EntityReference)[];
  publisher?: Organization | EntityReference;
  image?: string | readonly (string | ImageObject)[];
  keywords?: string | readonly string[];
  inLanguage?: string;
  description?: string;
  url?: string;
}
export declare const ArticleJsonLd: AstroComponentWithProps<ArticleJsonLdProps>;

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
  /** Documentation version label, such as `v2`. */
  version?: string;
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
