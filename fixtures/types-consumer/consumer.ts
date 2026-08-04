// Consumer-side type smoke test. This file is never executed: it is typechecked
// against the oldest TypeScript we support (see `pnpm run test:types`) to prove
// the hand-written declarations in `src/index.d.ts` and `components/index.d.ts`
// still parse and resolve for a downstream project on an older toolchain than
// the repo's own. The repo typecheck only ever sees them through the current
// TypeScript, so without this a newer-only type feature would ship unnoticed.
import aeo from 'astro-aeo';
import type {
  AeoPage,
  AstroAeoConfig,
  CanonicalAeoConfig,
  CorpusOptions,
  DiscoveryOptions,
  EntityType,
  ExtractionOptions,
  MarkdownOptions,
  PagesOptions,
  ResolvedAeoConfig,
  ResolvedAstroAeoConfig,
  SectionRule,
  SiteOptions,
  SitemapPolicy,
} from 'astro-aeo';
import { defineAeoPage } from 'astro-aeo/page';
import type { AeoPageInput, CatalogPage, PageCatalog } from 'astro-aeo/page';
import type {
  AeoPageProps,
  ArticleJsonLdProps,
  BreadcrumbJsonLdProps,
  FaqJsonLdProps,
  HowToJsonLdProps,
  OrganizationJsonLdProps,
  SpeakableJsonLdProps,
} from 'astro-aeo/components';

// The integration is callable with no arguments and yields an AstroIntegration.
export const bareName: string = aeo().name;

// Every documented `match` shape resolves.
export const sections: SectionRule[] = [
  { title: 'Home', match: '/' },
  { title: 'Blog', match: ['/blog/**', '/posts/**'] },
  { title: 'Archive', match: /^\/20[0-9]{2}\// },
  { title: 'Detailed', match: (page: AeoPage) => page.description.length > 100 },
];

// A config touching every top-level option group.
export const config: AstroAeoConfig = {
  include: ['**'],
  exclude: ['/private/**'],
  respectNoindex: true,
  stripTitleSuffix: ' | Example',
  site: { name: 'Example', description: 'An example site.' },
  dotmd: { enabled: true, linkTag: 'auto', includeLastModified: true, frontmatter: true },
  llmsTxt: { enabled: true, sections, defaultSection: 'Pages', includeDescriptions: true },
  llmsFullTxt: { enabled: true, mode: 'index' },
  urlMap: { enabled: false, outputFilepath: 'docs/Url-Map.md' },
  robotsTxt: { enabled: true, allow: ['GPTBot'], disallow: ['CCBot'], extraLines: ['# hi'] },
  domainProfile: { enabled: true, name: 'Example', entityType: 'Organization' },
  sitemap: { enabled: true, options: { filenameBase: 'sitemap' } },
  sitemapAlias: { enabled: true, outputFilename: 'sitemap.xml' },
};

export const integrationName: string = aeo(config).name;

// `ResolvedAeoConfig` is fully defaulted, so nested members are non-optional.
declare const resolved: ResolvedAeoConfig;
export const resolvedEnabled: boolean = resolved.dotmd.enabled;
export const resolvedEntity: EntityType = resolved.domainProfile.entityType;

// The resolved type is hand-written, and `src/index.d.ts` is only ever compiled
// with `skipLibCheck` (Astro's own declarations do not typecheck without it), so
// an assertion written there would never be evaluated. These reads are the actual
// drift guard: they run in a real .ts consumer, on the oldest supported compiler.
declare const resolvedCanonical: ResolvedAstroAeoConfig;
export const rAlternateLink: 'auto' | 'always' | 'never' = resolvedCanonical.markdown.alternateLink;
export const rNegotiation: 'off' | 'response' | 'redirect' = resolvedCanonical.markdown.negotiation;
export const rSelectors: string[] = resolvedCanonical.markdown.extraction.selectors;
export const rKeep: string[] = resolvedCanonical.markdown.extraction.keepSelectors;
export const rMode: 'all' | 'index' | 'first-page-only' = resolvedCanonical.corpus.full.mode;
export const rEntity: EntityType = resolvedCanonical.site.profile.entityType;
export const rSections: SectionRule[] = resolvedCanonical.corpus.index.sections;
export const rDefaultSection: string | false = resolvedCanonical.corpus.index.defaultSection;
export const rStrip: string | string[] | RegExp | false = resolvedCanonical.pages.stripTitleSuffix;
export const rInclude: string[] = resolvedCanonical.pages.include;
// A free-form passthrough must stay assignable to Record<string, unknown>. The
// derived type this replaced collapsed it to Record<string, {}>, which forced a
// cast at the one place that builds it.
export const rSitemapOptions: Record<string, unknown> = resolvedCanonical.discovery.sitemap.options;
// A resolved-only field with no public counterpart. A type derived from the public
// shape could not express this, which is why the resolved config is hand-written.
export const rPolicy: SitemapPolicy = resolvedCanonical.discovery.robots.sitemapPolicy;
export const rMode2: 'auto' | 'external' | 'disabled' = resolvedCanonical.discovery.sitemap.mode;

// The canonical and legacy halves compose into the public type.
export const canonicalOnly: CanonicalAeoConfig = { site: { name: 'Example' } };
export const siteOpts: SiteOptions = { name: 'Example', description: 'An example site.' };
export const pageOpts: PagesOptions = { include: ['**'], exclude: ['/private/**'], respectNoindex: true };
export const mdOpts: MarkdownOptions = {
  enabled: true,
  alternateLink: 'auto',
  frontmatter: true,
  negotiation: 'response',
  extraction: { selectors: ['article', 'main'], removeSelectors: ['nav'], keepSelectors: [] },
};
export const extractionOpts: ExtractionOptions = { selectors: ['main'] };
export const discoveryOpts: DiscoveryOptions = {
  sitemap: { mode: 'external', options: { filenameBase: 'sitemap' }, alias: { enabled: true } },
  robots: { enabled: true, allow: ['GPTBot'], includeSitemap: true },
};
export const corpusOpts: CorpusOptions = {
  index: { sections, defaultSection: 'Pages', showLastModified: true, includeHtmlOnly: false },
  full: { mode: 'index' },
  urlMap: { enabled: false, outputFilepath: 'docs/Url-Map.md' },
};

// A 1.0 block and its 1.1 replacement must both typecheck in one literal: the
// runtime accepts the combination and only errors when the two values disagree.
export const mixedEras: AstroAeoConfig = {
  domainProfile: { enabled: true },
  site: { profile: { name: 'Example', entityType: 'Organization' } },
  exclude: ['/private/**'],
  pages: { respectNoindex: true },
  dotmd: { includeLastModified: true },
  markdown: { frontmatter: true },
  llmsFullTxt: { enabled: true },
  corpus: { index: { includeDescriptions: true } },
  robotsTxt: { universalAllow: true },
  discovery: { robots: { enabled: true } },
};

// Component prop types are exported and structurally usable.
export const faq: FaqJsonLdProps = { items: [{ question: 'Q?', answer: 'A.' }] };
export const howTo: HowToJsonLdProps = {
  name: 'Bake bread',
  totalTime: 'PT5M',
  steps: [{ name: 'Mix', text: 'Mix the dough.' }],
};
export const crumbs: BreadcrumbJsonLdProps = { includeHome: true, labels: { blog: 'Blog' } };
export const org: OrganizationJsonLdProps = { name: 'Example', sameAs: ['https://example.com'] };
export const speakable: SpeakableJsonLdProps = { cssSelector: ['main'] };
export const article: ArticleJsonLdProps = { headline: 'Hello', author: { name: 'Ada' } };

// The source marker: `defineAeoPage` produces exactly the component's props.
export const markerInput: AeoPageInput = { markdown: '# X', title: 'X', lastModified: new Date() };
export const markerProps: AeoPageProps = defineAeoPage(markerInput);
export const catalog: PageCatalog = {
  name: 'blog',
  listPages(): CatalogPage[] {
    return [{ pathname: '/blog/hello', lastModified: '2026-01-01T00:00:00.000Z' }];
  },
};

// Negative assertions: these must stay errors, or the types have gone loose.
export const unknownOption: AstroAeoConfig = {
  // @ts-expect-error not a real option
  notAnOption: true,
};
// @ts-expect-error entityType is a closed union
export const badEntity: EntityType = 'Spaceship';
// @ts-expect-error llmsFullTxt.mode is a closed union
export const badMode: AstroAeoConfig = { llmsFullTxt: { mode: 'everything' } };
// @ts-expect-error dotmd.linkTag is a closed union
export const badLinkTag: AstroAeoConfig = { dotmd: { linkTag: 'sometimes' } };
// @ts-expect-error site.profile.entityType is a closed union
export const badProfileEntity: AstroAeoConfig = { site: { profile: { entityType: 'Spaceship' } } };
// @ts-expect-error `contact` was not carried into the canonical profile, only `email`
export const noProfileContact: AstroAeoConfig = { site: { profile: { contact: 'hi@x.com' } } };
// @ts-expect-error pages.include is a string array, not a single glob
export const badInclude: AstroAeoConfig = { pages: { include: '/blog/**' } };
// @ts-expect-error markdown.alternateLink is a closed union
export const badAlternate: AstroAeoConfig = { markdown: { alternateLink: 'sometimes' } };
// @ts-expect-error markdown.negotiation is a closed union
export const badNegotiation: AstroAeoConfig = { markdown: { negotiation: 'maybe' } };
// @ts-expect-error extraction selectors are an array of strings, not one string
export const badSelectors: AstroAeoConfig = { markdown: { extraction: { selectors: 'main' } } };
// @ts-expect-error `linkTag` was renamed to `alternateLink` in the canonical block
export const noMarkdownLinkTag: AstroAeoConfig = { markdown: { linkTag: 'auto' } };
// @ts-expect-error corpus.full.mode is a closed union
export const badCorpusMode: AstroAeoConfig = { corpus: { full: { mode: 'everything' } } };
// @ts-expect-error `showLastmod` was renamed to `showLastModified` in the canonical block
export const noShowLastmod: AstroAeoConfig = { corpus: { index: { showLastmod: true } } };
// @ts-expect-error discovery.sitemap.mode is a closed union
export const badSitemapMode: AstroAeoConfig = { discovery: { sitemap: { mode: 'on' } } };
// @ts-expect-error sitemapPolicy is resolved-only and has no public counterpart
export const noPublicPolicy: AstroAeoConfig = { discovery: { robots: { sitemapPolicy: 'auto' } } };
