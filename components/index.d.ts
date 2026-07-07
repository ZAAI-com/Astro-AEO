import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

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
