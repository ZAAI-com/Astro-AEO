// Consumer-side type smoke test. This file is never executed: it is typechecked
// against the oldest TypeScript we support (see `pnpm run test:types`) to prove
// the hand-written declarations in `src/index.d.ts` and `components/index.d.ts`
// still parse and resolve for a downstream project on an older toolchain than
// the repo's own. The repo typecheck only ever sees them through the current
// TypeScript, so without this a newer-only type feature would ship unnoticed.
import aeo from 'astro-aeo';
import type { ComponentProps } from 'astro/types';
import type {
  AeoGraph,
  AeoPage,
  AeoPageRecord,
  Artifact,
  ArtifactOwner,
  ArtifactOwnershipManifestV1,
  AstroAeoPlugin,
  AstroAeoPluginStage,
  AstroAeoConfig,
  CanonicalAeoConfig,
  CorpusOptions,
  DiagnosticManifestV1,
  DiscoveryOptions,
  EntityId,
  EntityReference,
  EntityType,
  ExtractionOptions,
  ExtractionDiagnostics,
  ExtractedDocument,
  Diagnostic,
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
  ImmutablePluginValue,
  MarkdownRenderer,
  MarkdownRendererDescriptor,
  MarkdownRendererInput,
  MarkdownRendererModule,
  MarkdownRendererResult,
  MarkdownOptions,
  MetadataOptions,
  PageCatalog,
  PageDescriptor,
  PageSource,
  PagesOptions,
  Representation,
  ResolvedAeoConfig,
  ResolvedAstroAeoConfig,
  RuntimePluginPageHandle,
  SchemaEntity,
  SchemaOptions,
  SchemaValidationResult,
  SectionRule,
  SiteOptions,
  SitemapPolicy,
  ValidationOptions,
} from 'astro-aeo';
import { defineAeoPage } from 'astro-aeo/page';
import { DEFAULT_EXTRACTION, extractHtml } from 'astro-aeo/extract';
import type { ExtractedDocument as ExtractedDocumentFromSubpath } from 'astro-aeo/extract';
import {
  connect,
  createArticle,
  createBlogPosting,
  createBreadcrumbList,
  createEntity,
  createEvent,
  createFAQPage,
  createGraph,
  createHowTo,
  createId,
  createImageObject,
  createLocalBusiness,
  createOffer,
  createOrganization,
  createPerson,
  createProduct,
  createService,
  createSoftwareApplication,
  createVideoObject,
  createWebPage,
  createWebSite,
  deduplicateGraph,
  mergeGraph,
  ref,
  serializeGraph,
  validateGraph,
} from 'astro-aeo/schema';
import type {
  Person,
  WebPage,
} from 'astro-aeo/schema';
import type {
  AeoPageInput,
  CatalogContext,
  CatalogPage,
  PageDescriptor as PageDescriptorFromSubpath,
} from 'astro-aeo/page';
import mdxRenderer from 'astro-aeo/mdx';
import defuddleRenderer from 'astro-aeo/defuddle';
import type { MdxRendererOptions } from 'astro-aeo/mdx';
import type { DefuddleRendererOptions } from 'astro-aeo/defuddle';
import { AeoHead } from 'astro-aeo/components';
import type {
  AeoHeadProps,
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

export const rendererDescriptor: MarkdownRendererDescriptor = {
  module: new URL('./renderer.js', import.meta.url),
  options: { flavor: 'commonmark', mappings: ['Callout'] },
};
export const inlineRenderer: MarkdownRenderer = (input: Readonly<MarkdownRendererInput>) => (
  input.pathname === '/empty'
    ? { status: 'rendered', markdown: '' }
    : { status: 'continue', diagnostics: [{ code: 'consumer-renderer', message: 'Use extraction.' }] }
);
export const rendererResult: MarkdownRendererResult = { status: 'fallback-to-html' };
export const rendererModule: MarkdownRendererModule = {
  name: 'consumer-renderer',
  apiVersion: 1,
  render: inlineRenderer,
};

interface PluginEnvelope {
  count: number;
  nested: { enabled: boolean };
}

export const plugin: AstroAeoPlugin = {
  name: 'consumer-plugin',
  apiVersion: 1,
  setup(api) {
    const command: 'dev' | 'build' | 'preview' = api.command;
    const options = api.options;
    void command;
    void options;
    api.claimArtifact({ id: 'answers', pathname: '/answers.json', replace: true });
    api.on<PluginEnvelope>('page:transform', async ({ value, mode, pages }) => {
      const stageMode: 'build' | 'runtime' = mode;
      const firstPage: RuntimePluginPageHandle | undefined = pages?.[0];
      const page = await firstPage?.read();
      void stageMode;
      void page?.representations.markdown;
      // @ts-expect-error hook inputs are deeply immutable
      value.nested.enabled = false;
      return {
        action: 'replace',
        value: { count: value.count + 1, nested: { enabled: value.nested.enabled } },
        diagnostics: [{ code: 'consumer-transform', message: 'Transformed.', recoverable: true }],
      };
    });
  },
  runtime: { entrypoint: './consumer-plugin-runtime.js', options: { format: 'json' } },
};
export const pluginStage: AstroAeoPluginStage = 'build:complete';

// A config touching every top-level option group.
export const config: AstroAeoConfig = {
  include: ['**'],
  exclude: ['/private/**'],
  respectNoindex: true,
  stripTitleSuffix: ' | Example',
  site: {
    name: 'Example',
    description: 'An example site.',
    defaultLocale: 'en',
    organization: { '@type': 'Organization', name: 'Example' },
  },
  artifacts: { replace: ['/llms.txt'] },
  metadata: {
    fillMissing: true,
    defaults: {
      title: 'Example',
      description: 'An example site.',
      robots: ['index', 'follow'],
      openGraph: { type: 'website', images: [{ url: '/cover.jpg', alt: 'Cover' }] },
      twitter: { card: 'summary_large_image' },
      locale: 'en_US',
      themeColor: [{ color: '#fff', media: '(prefers-color-scheme: light)' }],
      author: [{ name: 'Ada', url: 'https://example.com/ada' }],
    },
  },
  schema: {
    autoInject: true,
    infer: ['website', 'webpage', 'breadcrumbs'],
    strictReferences: true,
    corpus: {
      enabled: true,
      graphPath: '/schema/graph.jsonld',
      mapPath: '/schema/schema-map.xml',
    },
  },
  validation: { onBuild: 'artifacts', failOn: 'error' },
  plugins: [plugin],
  dotmd: { enabled: true, linkTag: 'auto', includeLastModified: true, frontmatter: true },
  llmsTxt: { enabled: true, sections, defaultSection: 'Pages', includeDescriptions: true },
  llmsFullTxt: { enabled: true, mode: 'index' },
  urlMap: { enabled: false, outputFilepath: 'docs/Url-Map.md' },
  robotsTxt: { enabled: true, allow: ['GPTBot'], disallow: ['CCBot'], extraLines: ['# hi'] },
  domainProfile: { enabled: true, name: 'Example', entityType: 'Organization' },
  sitemap: { enabled: true, options: { filenameBase: 'sitemap' } },
  sitemapAlias: { enabled: true, outputFilename: 'sitemap.xml' },
  markdown: { strategy: 'auto', renderers: [rendererDescriptor, inlineRenderer] },
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
export const rRuntimePages: number | 'unlimited' = resolvedCanonical.corpus.runtime.maxPages;
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
export const rLocale: string | undefined = resolvedCanonical.site.defaultLocale;
export const rOrganization: SchemaEntity | EntityReference | undefined = resolvedCanonical.site.organization;
export const rStrategy: 'auto' = resolvedCanonical.markdown.strategy;
export const rRenderers: (MarkdownRendererDescriptor | MarkdownRenderer)[] = resolvedCanonical.markdown.renderers;
export const rReplacements: string[] = resolvedCanonical.artifacts.replace;
export const rFillMissing: boolean = resolvedCanonical.metadata.fillMissing;
export const rMetadataDefaults = resolvedCanonical.metadata.defaults;
export const rAutoInject: boolean = resolvedCanonical.schema.autoInject;
export const rSchemaPaths: [string, string] = [
  resolvedCanonical.schema.corpus.graphPath,
  resolvedCanonical.schema.corpus.mapPath,
];
export const rValidation: ['artifacts' | 'recommended' | 'off', 'error' | 'warning'] = [
  resolvedCanonical.validation.onBuild,
  resolvedCanonical.validation.failOn,
];
export const rPlugins: AstroAeoPlugin[] = resolvedCanonical.plugins;

// The canonical and legacy halves compose into the public type.
export const canonicalOnly: CanonicalAeoConfig = { site: { name: 'Example' } };
export const siteOpts: SiteOptions = {
  name: 'Example',
  description: 'An example site.',
  defaultLocale: 'en',
  organization: { '@type': 'Organization', name: 'Example' },
};
export const pageOpts: PagesOptions = { include: ['**'], exclude: ['/private/**'], respectNoindex: true };
export const mdOpts: MarkdownOptions = {
  enabled: true,
  strategy: 'auto',
  renderers: [rendererDescriptor, inlineRenderer],
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
  runtime: { maxPages: 50 },
};
export const metadataOpts: MetadataOptions = {
  fillMissing: false,
  defaults: { locale: 'en_US', openGraph: { type: 'website' } },
};
export const schemaOpts: SchemaOptions = {
  autoInject: false,
  infer: ['website'],
  strictReferences: false,
  corpus: { enabled: false, graphPath: '/schema/site.jsonld', mapPath: '/schema/site.xml' },
};
export const validationOpts: ValidationOptions = { onBuild: 'recommended', failOn: 'warning' };

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
export const head: AeoHeadProps = {
  title: 'Hello',
  description: 'A page.',
  canonical: new URL('https://example.com/hello'),
  robots: ['index', 'follow'],
  openGraph: {
    type: 'article',
    title: 'Hello',
    description: 'A page.',
    url: '/hello',
    siteName: 'Example',
    images: [
      '/cover.jpg',
      { url: new URL('https://example.com/cover-wide.jpg'), secureUrl: '/cover-secure.jpg', width: 1200, height: 630, alt: 'Cover' },
    ],
    localeAlternates: ['de_DE'],
  },
  twitter: {
    card: 'player',
    site: '@example',
    creator: '@ada',
    title: 'Hello',
    description: 'A page.',
    image: '/cover.jpg',
    imageAlt: 'Cover',
    player: { url: '/player', width: 1280, height: 720, stream: '/stream.mp4' },
    apps: [{ platform: 'iphone', name: 'Example', id: '123', url: 'example://hello' }],
  },
  locale: 'en_US',
  hreflang: [{ lang: 'de', href: '/de/hello' }],
  feeds: [{ href: '/feed.xml', type: 'application/atom+xml', title: 'News' }],
  pagination: { previous: '/page/1', next: '/page/3' },
  markdownAlternate: { href: '/hello.md', title: 'Markdown' },
  themeColor: [{ color: '#fff', media: '(prefers-color-scheme: light)' }],
  authors: [{ name: 'Ada', url: '/people/ada' }],
  graph: { '@type': 'WebPage', '@id': 'https://example.com/hello#webpage', name: 'Hello' },
  infer: ['website', 'webpage'],
};
export const explicitHeadWithoutInference: AeoHeadProps = { graph: createGraph([]), infer: false };
export const legacyHeadAuthor: AeoHeadProps = { author: 'Ada' };
export const inferredHeadProps: ComponentProps<typeof AeoHead> = head;

export const mdxOptions: MdxRendererOptions = {
  components: {
    Callout: { action: 'unwrap' },
    Tracking: { action: 'omit' },
    Figure: { action: 'element', name: 'figure' },
  },
};
export const defuddleOptions: DefuddleRendererOptions = {
  removeHiddenElements: true,
  contentSelector: 'main',
  includeReplies: 'extractors',
};
export const mdxModule: MarkdownRendererModule = mdxRenderer;
export const defuddleModule: MarkdownRendererModule = defuddleRenderer;

// The source marker: `defineAeoPage` produces exactly the component's props.
export const markerInput: AeoPageInput = {
  markdown: '# X',
  title: 'X',
  description: 'Page X.',
  image: '/x.jpg',
  language: 'en',
  published: '2026-01-01',
  lastModified: new Date(),
  sourcePath: 'src/pages/x.mdx',
  sourceKind: 'mdx',
  authors: [],
  entities: [{ '@type': 'WebPage', name: 'X' }],
  directives: { index: true, includeInLlms: true, includeInLlmsFull: false, generateMarkdown: true },
};
export const markerProps: AeoPageProps = defineAeoPage(markerInput);
export const source: PageSource = { kind: 'mdx', path: 'src/pages/blog/hello.mdx', body: '# Hello', hash: 'sha256:value' };
export const descriptor: PageDescriptor = {
  pathname: '/blog/hello',
  routePattern: '/blog/[slug]',
  rendering: 'on-demand',
  title: 'Hello',
  description: 'A post.',
  image: '/hello.jpg',
  language: 'en',
  markdown: '# Hello',
  dates: { published: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z' },
  authors: [],
  entities: [{ '@type': 'BlogPosting', headline: 'Hello' }],
  directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
  lastModified: '2026-01-02T00:00:00.000Z',
  sourcePath: 'src/pages/blog/hello.mdx',
  source,
  extraction: { strategy: 'mdx', selectedNodes: 1, inputCharacters: 7, outputCharacters: 7, removedNodes: 0 },
};
export const descriptorFromSubpath: PageDescriptorFromSubpath = descriptor;
export const catalog: PageCatalog = {
  name: 'blog',
  listPages(context: CatalogContext): CatalogPage[] {
    void context.siteUrl;
    return [{ pathname: '/blog/hello', lastModified: '2026-01-01T00:00:00.000Z' }];
  },
};
export const record: AeoPageRecord = {
  id: '/blog/hello',
  pathname: '/blog/hello',
  routePattern: '/blog/[slug]',
  rendering: 'on-demand',
  url: 'https://runtime.example/blog/hello',
  canonicalUrl: 'https://example.com/blog/hello',
  markdownUrl: 'https://example.com/blog/hello.md',
  language: 'en',
  metadata: {
    title: 'Hello',
    description: 'A post.',
    image: 'https://example.com/hello.jpg',
    canonicalSource: 'authored',
  },
  representations: { html: '<main>Hello</main>', markdown: '# Hello', plainText: 'Hello' },
  dates: { published: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z' },
  authors: [],
  entities: [{ '@type': 'BlogPosting', headline: 'Hello' }],
  directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
  mdHref: '/blog/hello.md',
  title: 'Hello',
  description: 'A post.',
  markdown: '# Hello',
  lastModified: '2026-01-02T00:00:00.000Z',
  aeoTokens: [],
  source: { kind: 'mdx', strategy: 'marker', path: 'src/pages/blog/hello.mdx', body: '# Hello', hash: 'sha256:value' },
  extraction: { strategy: 'mdx', selectedNodes: 1, inputCharacters: 7, outputCharacters: 7, removedNodes: 0 },
  diagnostics: [],
};
const { canonicalUrl: omittedCanonical, ...recordWithoutStableCanonical } = record;
void omittedCanonical;
export const recordWithOptionalCanonical: AeoPageRecord = {
  ...recordWithoutStableCanonical,
  metadata: { title: 'Hello' },
};
export const recordTokens: string[] = record.aeoTokens;
export const recordRendering: 'prerendered' | 'on-demand' = record.rendering;
export const recordDate: string | undefined = record.lastModified;
export const extraction: ExtractionDiagnostics | undefined = record.extraction;
export const diagnostic: Diagnostic = { version: 1, code: 'example', severity: 'info', message: 'Example' };
export const extractionDefaults: string[] = DEFAULT_EXTRACTION.selectors;
export const extractedPromise: Promise<ExtractedDocument> = extractHtml('<main>Hello</main>');
export const extractedFromSubpath: Promise<ExtractedDocumentFromSubpath> = extractedPromise;
export const representation: Representation = { body: 'Answers\n', contentType: 'text/plain; charset=utf-8' };
export const artifact: Artifact = { pathname: '/answers.txt', representation, replace: true };
export const artifactOwner: ArtifactOwner = { kind: 'plugin', name: 'consumer-plugin', claimId: 'answers' };

export const diagnosticsManifest: DiagnosticManifestV1 = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  pages: [{ pathname: '/blog/hello', source: 'marker', sourcePath: 'src/pages/blog/hello.mdx', diagnostics: [] }],
  diagnostics: [diagnostic],
};
export const ownershipManifest: ArtifactOwnershipManifestV1 = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  base: '/',
  outputRootId: 'sha256:output',
  artifacts: [
    {
      pathname: '/answers.txt',
      status: 'emitted',
      owner: { kind: 'plugin', name: 'consumer-plugin', claimId: 'answers' },
      outputPath: 'answers.txt',
      representation: { contentType: 'text/plain; charset=utf-8', byteLength: 8, etag: '"hash"' },
      replacedOwners: [{ kind: 'public-file' }],
    },
    {
      pathname: '/llms.txt',
      status: 'preserved',
      owner: { kind: 'core', name: 'llmsTxt' },
      blockingOwners: [{ kind: 'project-route', rendering: 'on-demand', routePattern: '/llms.txt' }],
    },
    {
      pathname: '/llms-full.txt',
      status: 'runtime',
      owner: { kind: 'core', name: 'llmsFullTxt' },
      replacedOwners: [{ kind: 'public-file' }],
    },
    {
      pathname: '/collision.txt',
      status: 'conflict',
      claimants: [{ owner: { kind: 'plugin', name: 'one' }, count: 2 }],
    },
    {
      pathname: '/schema/graph.jsonld',
      status: 'group-skipped',
      owner: { kind: 'core', name: 'schemaGraph' },
      group: 'schema-corpus',
      causedBy: ['/schema/schema-map.xml'],
    },
  ],
  groups: [{
    id: 'schema-corpus',
    mode: 'all-or-none',
    pathnames: ['/schema/graph.jsonld', '/schema/schema-map.xml'],
    status: 'skipped',
  }],
};

// The edge-safe schema subpath accepts schema-dts entities and preserves typed IDs.
type PersonEntity = Extract<Person, { '@type': 'Person' }>;
type WebPageEntity = Extract<WebPage, { '@type': 'WebPage' }>;
export const schemaPersonId = createId<PersonEntity>('https://example.com/#ada');
export const schemaPerson = createPerson({ '@id': schemaPersonId, name: 'Ada' });
export const schemaPersonRef: EntityReference<PersonEntity> = ref(schemaPerson);
export const schemaPageId = createId<WebPageEntity>('https://example.com/#page');
export const schemaPage = connect(
  createWebPage({ '@id': schemaPageId, name: 'Page' }),
  'author',
  schemaPersonRef,
);
export const schemaDataset: SchemaEntity = createEntity({ '@type': 'Dataset', name: 'Evidence' });
export const genericSchemaEntity: SchemaEntity = {
  '@type': 'Dataset',
  '@id': createId('https://example.com/#dataset'),
  name: 'Evidence',
};
export const genericSchemaReference: EntityReference = ref(genericSchemaEntity);
export const schemaGraph: AeoGraph = createGraph([schemaPage, schemaPerson, schemaDataset]);
export const schemaJson: string = serializeGraph(schemaGraph);
export const schemaId: EntityId = createId('https://example.com/#thing');
export const graphRole: GraphRole = 'mainEntity';
export const provenanceSource: GraphProvenanceSource = 'plugin';
export const graphProvenance: GraphProvenance = {
  source: provenanceSource,
  pointer: '/name',
  pathname: '/blog/hello',
  plugin: 'consumer-plugin',
};
export const graphEntryInput: GraphEntryInput = {
  entity: schemaPage,
  roles: ['page', graphRole],
  provenance: graphProvenance,
};
export const graphInput: GraphInput = graphEntryInput;
export const mergeOptions: GraphMergeOptions = { conflictPolicy: 'first' };
export const conflictPolicy: GraphConflictPolicy = 'error';
export const mergedGraph: AeoGraph = mergeGraph([schemaGraph, graphInput], mergeOptions);
export const deduplicatedGraph: AeoGraph = deduplicateGraph(mergedGraph, { conflictPolicy: 'last' });
export const validationOptions: GraphValidationOptions = {
  documentCanonical: 'https://example.com/blog/hello',
  siteUrl: new URL('https://example.com/'),
  knownEntityIds: ['https://example.com/#ada'],
  strictReferences: true,
};
export const validationResult: GraphValidationResult = validateGraph(deduplicatedGraph, validationOptions);
export const schemaValidationResult: SchemaValidationResult = validationResult;
export const graphEntry: GraphEntry = validationResult.graph.entries[0];
export const graphConflict: GraphConflict = {
  entityId: schemaId,
  pointer: '/name',
  policy: conflictPolicy,
  resolution: 'unresolved',
  first: [graphProvenance],
  incoming: [{ source: 'configuration' }],
};
export const graphFinding: GraphFinding = {
  version: 1,
  code: 'example-finding',
  severity: 'warning',
  message: 'Example finding.',
  entityId: schemaId,
};

// Every P0 builder is reachable from the published schema subpath.
export const p0Entities: SchemaEntity[] = [
  createWebSite({ name: 'Example' }),
  createWebPage({ name: 'Page' }),
  createPerson({ name: 'Ada' }),
  createOrganization({ name: 'Example' }),
  createArticle({ headline: 'Article' }),
  createBlogPosting({ headline: 'Post' }),
  createBreadcrumbList({ name: 'Breadcrumbs' }),
  createImageObject({ name: 'Image' }),
  createVideoObject({ name: 'Video' }),
  createProduct({ name: 'Product' }),
  createSoftwareApplication({ name: 'Application' }),
  createService({ name: 'Service' }),
  createOffer({ name: 'Offer' }),
  createFAQPage({ name: 'FAQ' }),
  createHowTo({ name: 'How to' }),
  createEvent({ name: 'Event' }),
  createLocalBusiness({ name: 'Business' }),
];

export const frozenPluginValue: ImmutablePluginValue<PluginEnvelope> = {
  count: 1,
  nested: { enabled: true },
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
// @ts-expect-error runtime maxPages is a number or the explicit unlimited sentinel
export const badRuntimePages: AstroAeoConfig = { corpus: { runtime: { maxPages: 'many' } } };
// @ts-expect-error discovery.sitemap.mode is a closed union
export const badSitemapMode: AstroAeoConfig = { discovery: { sitemap: { mode: 'on' } } };
// @ts-expect-error schema builders own their exact @type
export const badPerson = createPerson({ '@type': 'Organization', name: 'Wrong' });
// @ts-expect-error sitemapPolicy is resolved-only and has no public counterpart
export const noPublicPolicy: AstroAeoConfig = { discovery: { robots: { sitemapPolicy: 'auto' } } };
// @ts-expect-error 1.3 i18n configuration is intentionally absent in 1.2
export const noI18nYet: AstroAeoConfig = { i18n: { indexes: 'auto' } };
// @ts-expect-error 1.3 cache configuration is intentionally absent in 1.2
export const noCacheYet: AstroAeoConfig = { cache: { enabled: true } };
// @ts-expect-error 1.3 IndexNow configuration is intentionally absent in 1.2
export const noIndexNowYet: AstroAeoConfig = { discovery: { indexNow: { enabled: true } } };
// @ts-expect-error 1.3 corpus chunking configuration is intentionally absent in 1.2
export const noChunksYet: AstroAeoConfig = { corpus: { chunks: { enabled: true } } };
// @ts-expect-error 1.5 analytics configuration is intentionally absent in 1.2
export const noAnalyticsYet: AstroAeoConfig = { analytics: { enabled: true } };
// @ts-expect-error artifact replacements are exact pathname arrays, never globs as a scalar
export const badReplacementType: AstroAeoConfig = { artifacts: { replace: '/**' } };
// @ts-expect-error schema.infer is a closed 1.2 role union
export const badInference: AstroAeoConfig = { schema: { infer: ['organization'] } };
// @ts-expect-error renderer options must be strict JSON data
export const badRendererOptions: MarkdownRendererDescriptor = { module: './renderer.js', options: new Date() };
// @ts-expect-error plugin API v1 is the only published lifecycle version
export const badPluginVersion: AstroAeoPlugin = { name: 'future', apiVersion: 2, setup() {} };
// @ts-expect-error AeoHead canonicals must be URLs, not numeric request state
export const badHeadCanonical: AeoHeadProps = { canonical: 42 };
// @ts-expect-error AeoHead's component value must retain the same canonical prop contract
export const badInferredHeadCanonical: ComponentProps<typeof AeoHead> = { canonical: 42 };
