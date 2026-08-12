import type {
  Article,
  BlogPosting,
  BreadcrumbList,
  Event,
  FAQPage,
  Graph as SchemaOrgGraph,
  HowTo,
  ImageObject,
  JsonLdObject,
  LocalBusiness,
  Offer,
  Organization,
  Person,
  Product,
  Service,
  SoftwareApplication,
  Thing,
  VideoObject,
  WebPage,
  WebSite,
} from 'schema-dts';

export type {
  Article,
  BlogPosting,
  BreadcrumbList,
  Event,
  FAQPage,
  Graph as SchemaOrgGraph,
  HowTo,
  ImageObject,
  JsonLdObject,
  LocalBusiness,
  Offer,
  Organization,
  Person,
  Product,
  Service,
  SoftwareApplication,
  Thing,
  VideoObject,
  WebPage,
  WebSite,
} from 'schema-dts';

declare const schemaIdBrand: unique symbol;
declare const schemaEntityType: unique symbol;
declare const schemaReferenceType: unique symbol;

/** The object-valued members of schema-dts's `Thing` vocabulary union. */
export type SchemaThing = Exclude<Thing, string>;

/** Open vocabulary fallback used when a caller does not select one schema-dts leaf. */
export interface GenericSchemaEntity extends JsonLdObject {
  readonly [property: string]: unknown;
}

/** A validated, absolute JSON-LD identifier branded with its entity type. */
export type SchemaId<T extends JsonLdObject = JsonLdObject> = string & {
  readonly [schemaIdBrand]: T['@type'];
};

/** Public roadmap spelling retained alongside the more vocabulary-specific alias. */
export type EntityId<T extends JsonLdObject = JsonLdObject> = SchemaId<T>;

/** An ID-only JSON-LD reference. Relative IDs remain valid until graph validation. */
export interface EntityReference<T extends JsonLdObject = JsonLdObject> {
  readonly '@id': string;
  readonly [schemaReferenceType]?: T;
}

/** A schema-dts entity whose optional ID is structurally safe but may be relative. */
export type SchemaEntity<T extends JsonLdObject = never> = [T] extends [never]
  ? GenericSchemaEntity & { readonly '@id'?: string }
  : T extends unknown
    ? Omit<T, '@id'> & { readonly '@id'?: string; readonly [schemaEntityType]?: T }
    : never;

/** Select the exact leaf from one of schema-dts's subtype unions. */
export type ExactSchemaType<T, Name extends string> = T extends JsonLdObject
  ? T extends { '@type': Name }
    ? T
    : never
  : never;

/** Input for a builder that owns its entity's exact `@type`. */
export type SchemaBuilderInput<T extends JsonLdObject> = T extends unknown
  ? Omit<T, '@type'> & {
      readonly '@type'?: never;
      readonly '@context'?: never;
    }
  : never;

export type GraphRole =
  | 'site'
  | 'page'
  | 'breadcrumbs'
  | 'mainEntity'
  | 'author'
  | 'publisher'
  | 'supporting';

export type GraphProvenanceSource =
  | 'authored-jsonld'
  | 'authored-head'
  | 'configuration'
  | 'inference'
  | 'plugin'
  | 'api';

/** Provenance is retained beside the graph and never emitted as JSON-LD. */
export interface GraphProvenance {
  source: GraphProvenanceSource;
  /** RFC 6901 pointer. Omit it to describe the whole entity. */
  pointer?: string;
  pathname?: string;
  sourcePath?: string;
  plugin?: string;
}

export interface GraphEntryInput<T extends JsonLdObject = GenericSchemaEntity> {
  entity: T | SchemaEntity<T>;
  roles?: GraphRole | readonly GraphRole[];
  provenance?: GraphProvenance | readonly GraphProvenance[];
}

export interface GraphEntry<T extends JsonLdObject = never> {
  readonly entity: SchemaEntity<T>;
  readonly roles: readonly GraphRole[];
  readonly provenance: readonly GraphProvenance[];
}

export type GraphConflictPolicy = 'error' | 'first' | 'last';

/** A scalar conflict without either conflicting value. */
export interface GraphConflict {
  readonly entityId?: string;
  readonly role?: GraphRole;
  readonly pointer: string;
  readonly policy: GraphConflictPolicy;
  readonly resolution: 'unresolved' | 'first' | 'last';
  readonly first: readonly GraphProvenance[];
  readonly incoming: readonly GraphProvenance[];
}

export interface GraphFinding {
  readonly version: 1;
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly entityId?: string;
  readonly pointer?: string;
  readonly pathname?: string;
}

export interface AeoGraph {
  readonly version: 1;
  readonly entries: readonly GraphEntry[];
  readonly conflicts: readonly GraphConflict[];
}

export type GraphInput =
  | AeoGraph
  | SchemaOrgGraph
  | GenericSchemaEntity
  | GraphEntryInput
  | readonly (GenericSchemaEntity | GraphEntryInput)[];

export interface GraphMergeOptions {
  /** How equal-ID scalar conflicts resolve. Default: `error`. */
  conflictPolicy?: GraphConflictPolicy;
}

export interface GraphValidationOptions extends GraphMergeOptions {
  /** Stable page canonical used to resolve fragment and relative IDs. */
  documentCanonical?: string | URL;
  /** Configured Astro site, including its base path when applicable. */
  siteUrl?: string | URL;
  /** Complete collected ID set used for cross-page reference validation. */
  knownEntityIds?: readonly string[];
  /** Downgrade unresolved references to warnings when false. Default: true. */
  strictReferences?: boolean;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly graph: AeoGraph;
  readonly findings: readonly GraphFinding[];
  readonly conflicts: readonly GraphConflict[];
}

/** Public semantic-publishing spelling for a graph validation result. */
export type SchemaValidationResult = GraphValidationResult;

export declare class SchemaGraphError extends Error {
  readonly result: GraphValidationResult;
}

/** Resolve an ID only against the explicit base, never a request host. */
export declare function createId<T extends JsonLdObject = JsonLdObject>(
  value: string | URL,
  base?: string | URL,
): SchemaId<T>;

/** Clone and structurally validate an entity. Relative IDs are resolved by validateGraph. */
export declare function createEntity<const T extends JsonLdObject>(entity: T): SchemaEntity<T>;

/** Create an ID-only reference. An entity without an ID throws at runtime. */
export declare function ref<T extends JsonLdObject>(
  target: string | EntityReference<T> | SchemaEntity<T>,
): EntityReference<T>;

export interface ConnectOptions {
  /** Append and deduplicate by default, or replace the relation. */
  mode?: 'append' | 'replace';
}

/** Immutably attach an ID reference to a schema-dts relation. */
export declare function connect<Source extends JsonLdObject, Target extends JsonLdObject>(
  source: SchemaEntity<Source>,
  property: Exclude<Extract<keyof Source, string>, '@id' | '@type'>,
  target: string | EntityReference<Target> | SchemaEntity<Target>,
  options?: ConnectOptions,
): SchemaEntity<Source>;

export declare function createGraph(input: GraphInput, options?: GraphMergeOptions): AeoGraph;

export declare function mergeGraph(
  inputs: readonly GraphInput[],
  options?: GraphMergeOptions,
): AeoGraph;

export declare function deduplicateGraph(
  input: GraphInput,
  options?: GraphMergeOptions,
): AeoGraph;

export declare function validateGraph(
  input: GraphInput,
  options?: GraphValidationOptions,
): GraphValidationResult;

/** Serialize a valid graph as deterministic, inline-script-safe JSON-LD. */
export declare function serializeGraph(
  input: GraphInput,
  options?: GraphValidationOptions,
): string;

type WebSiteEntity = ExactSchemaType<WebSite, 'WebSite'>;
type WebPageEntity = ExactSchemaType<WebPage, 'WebPage'>;
type PersonEntity = ExactSchemaType<Person, 'Person'>;
type OrganizationEntity = ExactSchemaType<Organization, 'Organization'>;
type ArticleEntity = ExactSchemaType<Article, 'Article'>;
type BlogPostingEntity = ExactSchemaType<BlogPosting, 'BlogPosting'>;
type BreadcrumbListEntity = ExactSchemaType<BreadcrumbList, 'BreadcrumbList'>;
type ImageObjectEntity = ExactSchemaType<ImageObject, 'ImageObject'>;
type VideoObjectEntity = ExactSchemaType<VideoObject, 'VideoObject'>;
type ProductEntity = ExactSchemaType<Product, 'Product'>;
type SoftwareApplicationEntity = ExactSchemaType<SoftwareApplication, 'SoftwareApplication'>;
type ServiceEntity = ExactSchemaType<Service, 'Service'>;
type OfferEntity = ExactSchemaType<Offer, 'Offer'>;
type FAQPageEntity = ExactSchemaType<FAQPage, 'FAQPage'>;
type HowToEntity = ExactSchemaType<HowTo, 'HowTo'>;
type EventEntity = ExactSchemaType<Event, 'Event'>;
type LocalBusinessEntity = ExactSchemaType<LocalBusiness, 'LocalBusiness'>;

export declare function createWebSite(input: SchemaBuilderInput<WebSiteEntity>): SchemaEntity<WebSiteEntity>;
export declare function createWebPage(input: SchemaBuilderInput<WebPageEntity>): SchemaEntity<WebPageEntity>;
export declare function createPerson(input: SchemaBuilderInput<PersonEntity>): SchemaEntity<PersonEntity>;
export declare function createOrganization(
  input: SchemaBuilderInput<OrganizationEntity>,
): SchemaEntity<OrganizationEntity>;
export declare function createArticle(input: SchemaBuilderInput<ArticleEntity>): SchemaEntity<ArticleEntity>;
export declare function createBlogPosting(
  input: SchemaBuilderInput<BlogPostingEntity>,
): SchemaEntity<BlogPostingEntity>;
export declare function createBreadcrumbList(
  input: SchemaBuilderInput<BreadcrumbListEntity>,
): SchemaEntity<BreadcrumbListEntity>;
export declare function createImageObject(
  input: SchemaBuilderInput<ImageObjectEntity>,
): SchemaEntity<ImageObjectEntity>;
export declare function createVideoObject(
  input: SchemaBuilderInput<VideoObjectEntity>,
): SchemaEntity<VideoObjectEntity>;
export declare function createProduct(input: SchemaBuilderInput<ProductEntity>): SchemaEntity<ProductEntity>;
export declare function createSoftwareApplication(
  input: SchemaBuilderInput<SoftwareApplicationEntity>,
): SchemaEntity<SoftwareApplicationEntity>;
export declare function createService(input: SchemaBuilderInput<ServiceEntity>): SchemaEntity<ServiceEntity>;
export declare function createOffer(input: SchemaBuilderInput<OfferEntity>): SchemaEntity<OfferEntity>;
export declare function createFAQPage(input: SchemaBuilderInput<FAQPageEntity>): SchemaEntity<FAQPageEntity>;
export declare function createHowTo(input: SchemaBuilderInput<HowToEntity>): SchemaEntity<HowToEntity>;
export declare function createEvent(input: SchemaBuilderInput<EventEntity>): SchemaEntity<EventEntity>;
export declare function createLocalBusiness(
  input: SchemaBuilderInput<LocalBusinessEntity>,
): SchemaEntity<LocalBusinessEntity>;
