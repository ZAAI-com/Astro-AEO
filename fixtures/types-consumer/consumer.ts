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
  EntityType,
  ResolvedAeoConfig,
  ResolvedAstroAeoConfig,
  SectionRule,
  SiteOptions,
} from 'astro-aeo';
import type {
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
export const rLinkTag: 'auto' | 'always' | 'never' = resolvedCanonical.dotmd.linkTag;
export const rMode: 'all' | 'index' | 'first-page-only' = resolvedCanonical.llmsFullTxt.mode;
export const rEntity: EntityType = resolvedCanonical.site.profile.entityType;
export const rSections: SectionRule[] = resolvedCanonical.llmsTxt.sections;
export const rStrip: string | string[] | RegExp | false = resolvedCanonical.stripTitleSuffix;
// A free-form passthrough must stay assignable to Record<string, unknown>. The
// derived type this replaced collapsed it to Record<string, {}>, which forced a
// cast at the one place that builds it.
export const rSitemapOptions: Record<string, unknown> = resolvedCanonical.sitemap.options;

// The canonical and legacy halves compose into the public type.
export const canonicalOnly: CanonicalAeoConfig = { site: { name: 'Example' } };
export const siteOpts: SiteOptions = { name: 'Example', description: 'An example site.' };

// A 1.0 block and its 1.1 replacement must both typecheck in one literal: the
// runtime accepts the combination and only errors when the two values disagree.
export const mixedEras: AstroAeoConfig = {
  domainProfile: { enabled: true },
  site: { profile: { name: 'Example', entityType: 'Organization' } },
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
