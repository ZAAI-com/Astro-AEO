// @ts-check
import { isLoopbackHostname } from './core/canonical.js';

const SCHEMA_CONTEXT = 'https://schema.org';
const GRAPH_VERSION = 1;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DANGEROUS_SCHEMES = new Set(['data:', 'file:', 'javascript:', 'vbscript:']);
const GRAPH_ROLES = new Set([
  'site',
  'page',
  'breadcrumbs',
  'mainEntity',
  'author',
  'publisher',
  'supporting',
]);
const SINGLETON_ROLES = new Set(['site', 'page', 'breadcrumbs']);
const PROVENANCE_SOURCES = new Set([
  'authored-jsonld',
  'authored-head',
  'configuration',
  'inference',
  'plugin',
  'api',
]);
// Properties whose schema-dts range includes URL but not Text. A string in one
// of these positions is therefore a URL value, even when the property also
// accepts an inline entity. Keep this list explicit so arbitrary schema-dts
// entities remain edge-safe without importing vocabulary data at runtime.
const URL_PROPERTIES = new Set([
  'acquireLicensePage',
  'actionableFeedbackPolicy',
  'afterMedia',
  'archivedAt',
  'associatedDisease',
  'audio',
  'beforeMedia',
  'benefitsSummaryUrl',
  'codeRepository',
  'colleague',
  'colorSwatch',
  'constraintProperty',
  'contentUrl',
  'correctionsPolicy',
  'discussionUrl',
  'diseasePreventionInfo',
  'diseaseSpreadStatistics',
  'diversityPolicy',
  'diversityStaffingReport',
  'documentation',
  'downloadUrl',
  'duringMedia',
  'embedUrl',
  'ethicsPolicy',
  'gameLocation',
  'gettingTestedInfo',
  'hasGS1DigitalLink',
  'hasMap',
  'hasMolecularFunction',
  'healthPlanMarketingUrl',
  'image',
  'inCodeSet',
  'inDefinedTermSet',
  'installUrl',
  'isBasedOn',
  'isBasedOnUrl',
  'isInvolvedInBiologicalProcess',
  'isLocatedInSubcellularLocation',
  'isPartOf',
  'item',
  'labelDetails',
  'layoutImage',
  'license',
  'logo',
  'mainEntityOfPage',
  'map',
  'maps',
  'masthead',
  'merchantReturnLink',
  'missionCoveragePrioritiesPolicy',
  'newsUpdatesAndGuidelines',
  'noBylinesPolicy',
  'originalMediaLink',
  'paymentUrl',
  'prescribingInfo',
  'productReturnLink',
  'publicTransportClosuresInfo',
  'publishingPrinciples',
  'quarantineGuidelines',
  'relatedLink',
  'replyToUrl',
  'sameAs',
  'schoolClosuresInfo',
  'screenshot',
  'sdLicense',
  'season',
  'serviceUrl',
  'shippingSettingsLink',
  'significantLink',
  'significantLinks',
  'speakable',
  'target',
  'targetUrl',
  'thumbnailUrl',
  'tourBookingPage',
  'trackingUrl',
  'travelBans',
  'unnamedSourcesPolicy',
  'url',
  'usageInfo',
  'verificationFactCheckingPolicy',
  'video',
  'webFeed',
]);

// These properties accept both URL and ordinary textual vocabulary values.
// Only URL-shaped strings are checked so labels such as "JavaScript" or
// "data journalism" remain valid text instead of being treated as links.
const URL_OR_TEXT_PROPERTIES = new Set([
  'acceptsReservations',
  'actionPlatform',
  'additionalType',
  'applicationCategory',
  'applicationSubCategory',
  'artMedium',
  'artform',
  'artworkSurface',
  'asin',
  'bankAccountType',
  'bodyType',
  'category',
  'childTaxon',
  'competencyRequired',
  'correction',
  'courseMode',
  'credentialCategory',
  'editEIDR',
  'educationalCredentialAwarded',
  'educationalLevel',
  'educationalProgramMode',
  'encodingFormat',
  'engineType',
  'featureList',
  'feesAndCommissionsSpecification',
  'fileFormat',
  'fuelType',
  'gamePlatform',
  'genre',
  'gtin',
  'hasMenu',
  'hasRepresentation',
  'identifier',
  'keywords',
  'knowsAbout',
  'legislationIdentifier',
  'loanType',
  'material',
  'measurementMethod',
  'measurementTechnique',
  'meetsEmissionStandard',
  'memoryRequirements',
  'menu',
  'namedPosition',
  'occupationalCredentialAwarded',
  'ownershipFundingInfo',
  'parentTaxon',
  'physicalRequirement',
  'propertyID',
  'releaseNotes',
  'requirements',
  'roleName',
  'schemaVersion',
  'securityClearanceRequirement',
  'sensoryRequirement',
  'softwareRequirements',
  'sport',
  'statType',
  'storageRequirements',
  'surface',
  'taxonRank',
  'taxonomicRange',
  'temporalCoverage',
  'termsOfService',
  'ticketToken',
  'titleEIDR',
  'unitCode',
  'usesHealthPlanIdStandard',
  'vehicleTransmission',
  'warning',
]);

const LINE_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2029), 'g');

/** @typedef {'error' | 'first' | 'last'} ConflictPolicy */
/**
 * @typedef {{
 *   source: string,
 *   pointer?: string,
 *   pathname?: string,
 *   sourcePath?: string,
 *   plugin?: string,
 * }} Provenance
 */
/**
 * @typedef {{
 *   entity: Record<string, any>,
 *   roles: string[],
 *   provenance: Provenance[],
 * }} Entry
 */
/**
 * @typedef {{
 *   entityId?: string,
 *   role?: string,
 *   pointer: string,
 *   policy: ConflictPolicy,
 *   resolution: 'unresolved' | 'first' | 'last',
 *   first: Provenance[],
 *   incoming: Provenance[],
 * }} Conflict
 */
/**
 * @typedef {{
 *   version: 1,
 *   code: string,
 *   severity: 'info' | 'warning' | 'error',
 *   message: string,
 *   entityId?: string,
 *   pointer?: string,
 *   pathname?: string,
 * }} Finding
 */
/** @typedef {{version: 1, entries: Entry[], conflicts: Conflict[]}} RuntimeGraph */

export class SchemaGraphError extends Error {
  /**
   * @param {{valid: boolean, graph: RuntimeGraph, findings: Finding[], conflicts: Conflict[]}} result
   */
  constructor(result) {
    super('Schema graph validation failed');
    this.name = 'SchemaGraphError';
    this.result = result;
  }
}

/**
 * Create a stable, absolute JSON-LD identifier.
 *
 * A relative value is accepted only when an explicit base is provided. The
 * current request URL is deliberately never consulted.
 *
 * @param {string | URL} value
 * @param {string | URL} [base]
 * @returns {string}
 */
export function createId(value, base) {
  const raw = value instanceof URL ? value.href : requireString(value, 'ID');
  const rawBase = base instanceof URL ? base.href : base;
  let parsed;
  try {
    parsed = rawBase === undefined ? new URL(raw) : new URL(raw, requireString(rawBase, 'ID base'));
  } catch {
    throw new TypeError('Schema ID must be absolute or have an explicit absolute base');
  }
  assertSafeUrl(parsed, 'Schema ID');
  return parsed.href;
}

/**
 * Clone and structurally validate one schema-dts entity.
 * @template {Record<string, any>} T
 * @param {T} entity
 * @returns {T}
 */
export function createEntity(entity) {
  if (!isPlainObject(entity)) throw new TypeError('Schema entity must be a plain object');
  if (Object.hasOwn(entity, '@context')) {
    throw new TypeError('Schema entity must not contain @context; createGraph owns the context');
  }
  const cloned = /** @type {T} */ (cloneJson(entity, '', new Set()));
  assertEntityType(cloned);
  if (Object.hasOwn(cloned, '@id')) assertIdText(cloned['@id'], '/@id');
  return cloned;
}

/**
 * Return an ID-only JSON-LD reference.
 * @param {string | Record<string, any>} target
 * @returns {{'@id': string}}
 */
export function ref(target) {
  const id = typeof target === 'string' ? target : target?.['@id'];
  assertIdText(id, '/@id');
  return { '@id': id };
}

/**
 * Immutably connect one entity to another by ID reference.
 * @template {Record<string, any>} T
 * @param {T} source
 * @param {string} property
 * @param {string | Record<string, any>} target
 * @param {{mode?: 'append' | 'replace'}} [options]
 * @returns {T}
 */
export function connect(source, property, target, options = {}) {
  const entity = createEntity(source);
  requireSafeKey(property, 'Schema relation');
  if (property === '@id' || property === '@type' || property === '@context') {
    throw new TypeError(`Schema relation cannot replace ${property}`);
  }
  const mode = options.mode ?? 'append';
  if (mode !== 'append' && mode !== 'replace') {
    throw new TypeError('Schema relation mode must be "append" or "replace"');
  }
  const reference = ref(target);
  if (mode === 'replace' || !Object.hasOwn(entity, property)) {
    entity[property] = reference;
    return entity;
  }

  const previous = entity[property];
  const values = Array.isArray(previous) ? previous : [previous];
  if (!values.some((value) => isSameReference(value, reference))) {
    entity[property] = [...values, reference];
  }
  return entity;
}

/**
 * Normalize and merge graph input.
 * @param {unknown} input
 * @param {{conflictPolicy?: ConflictPolicy}} [options]
 * @returns {RuntimeGraph}
 */
export function createGraph(input, options = {}) {
  const policy = normalizeConflictPolicy(options.conflictPolicy);
  const collected = collectGraphInput(input);
  return mergeEntries(collected.entries, policy, collected.conflicts);
}

/**
 * Merge several graphs in their supplied order.
 * @param {readonly unknown[]} inputs
 * @param {{conflictPolicy?: ConflictPolicy}} [options]
 * @returns {RuntimeGraph}
 */
export function mergeGraph(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('mergeGraph expects an array of graph inputs');
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Conflict[]} */
  const conflicts = [];
  for (const input of inputs) {
    const collected = collectGraphInput(input);
    entries.push(...collected.entries);
    conflicts.push(...collected.conflicts);
  }
  return mergeEntries(entries, normalizeConflictPolicy(options.conflictPolicy), conflicts);
}

/**
 * Deduplicate a graph while retaining semantic array and entry order.
 * @param {unknown} input
 * @param {{conflictPolicy?: ConflictPolicy}} [options]
 * @returns {RuntimeGraph}
 */
export function deduplicateGraph(input, options = {}) {
  return createGraph(input, options);
}

/**
 * Validate a graph without throwing for malformed graph input.
 * @param {unknown} input
 * @param {{
 *   conflictPolicy?: ConflictPolicy,
 *   documentCanonical?: string | URL,
 *   siteUrl?: string | URL,
 *   knownEntityIds?: readonly string[],
 *   strictReferences?: boolean,
 * }} [options]
 * @returns {{valid: boolean, graph: RuntimeGraph, findings: Finding[], conflicts: Conflict[]}}
 */
export function validateGraph(input, options = {}) {
  /** @type {RuntimeGraph} */
  let graph;
  try {
    graph = createGraph(input, { conflictPolicy: options.conflictPolicy });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schema graph is structurally invalid';
    const empty = emptyGraph();
    const findings = [finding('schema.invalid-graph', 'error', message)];
    return { valid: false, graph: empty, findings, conflicts: empty.conflicts };
  }

  /** @type {Finding[]} */
  const findings = [];
  const documentCanonical = normalizeOptionalAbsoluteUrl(options.documentCanonical, 'Document canonical', findings);
  const siteUrl = normalizeOptionalAbsoluteUrl(options.siteUrl, 'Site URL', findings);
  const knownIds = normalizeKnownIds(options.knownEntityIds, documentCanonical, findings);
  const normalizedEntries = graph.entries.map((entry) => ({
    ...entry,
    entity: normalizeEntityIds(entry.entity, documentCanonical, findings),
  }));
  graph = mergeEntries(normalizedEntries, options.conflictPolicy ?? 'error', graph.conflicts);

  for (const conflict of graph.conflicts) {
    if (conflict.resolution === 'unresolved') {
      findings.push(
        finding('schema.scalar-conflict', 'error', 'Conflicting scalar graph values require an explicit policy', {
          entityId: conflict.entityId,
          pointer: conflict.pointer,
        }),
      );
    } else {
      findings.push(
        finding(
          'schema.scalar-conflict-resolved',
          'warning',
          `Conflicting scalar graph values used the ${conflict.resolution} value`,
          { entityId: conflict.entityId, pointer: conflict.pointer },
        ),
      );
    }
  }

  validateSingletonRoles(graph.entries, findings);
  validateUrlProperties(graph.entries, documentCanonical, findings);
  validateReferences(
    graph.entries,
    documentCanonical,
    siteUrl,
    knownIds,
    options.strictReferences !== false,
    findings,
  );

  return {
    valid: !findings.some((item) => item.severity === 'error'),
    graph,
    findings,
    conflicts: graph.conflicts,
  };
}

/**
 * Serialize one validated graph for safe inline JSON-LD use.
 * @param {unknown} input
 * @param {{
 *   conflictPolicy?: ConflictPolicy,
 *   documentCanonical?: string | URL,
 *   siteUrl?: string | URL,
 *   knownEntityIds?: readonly string[],
 *   strictReferences?: boolean,
 * }} [options]
 * @returns {string}
 */
export function serializeGraph(input, options = {}) {
  const result = validateGraph(input, options);
  if (!result.valid) throw new SchemaGraphError(result);
  const value = {
    '@context': SCHEMA_CONTEXT,
    '@graph': result.graph.entries.map((entry) => sortJson(entry.entity)),
  };
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(LINE_SEPARATOR_RE, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR_RE, '\\u2029');
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createWebSite(input) {
  return buildEntity('WebSite', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createWebPage(input) {
  return buildEntity('WebPage', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createPerson(input) {
  return buildEntity('Person', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createOrganization(input) {
  return buildEntity('Organization', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createArticle(input) {
  return buildEntity('Article', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createBlogPosting(input) {
  return buildEntity('BlogPosting', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createBreadcrumbList(input) {
  return buildEntity('BreadcrumbList', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createImageObject(input) {
  return buildEntity('ImageObject', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createVideoObject(input) {
  return buildEntity('VideoObject', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createProduct(input) {
  return buildEntity('Product', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createSoftwareApplication(input) {
  return buildEntity('SoftwareApplication', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createService(input) {
  return buildEntity('Service', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createOffer(input) {
  return buildEntity('Offer', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createFAQPage(input) {
  return buildEntity('FAQPage', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createHowTo(input) {
  return buildEntity('HowTo', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createEvent(input) {
  return buildEntity('Event', input);
}

/** @param {unknown} input @returns {ReturnType<typeof createEntity>} */
export function createLocalBusiness(input) {
  return buildEntity('LocalBusiness', input);
}

/**
 * @param {string} type
 * @param {unknown} input
 * @returns {Record<string, any>}
 */
function buildEntity(type, input) {
  if (!isPlainObject(input)) throw new TypeError(`${type} builder input must be a plain object`);
  if (Object.hasOwn(input, '@type')) throw new TypeError(`${type} builder owns @type`);
  if (Object.hasOwn(input, '@context')) throw new TypeError(`${type} builder input must not contain @context`);
  return createEntity({ '@type': type, ...input });
}

/**
 * @param {unknown} input
 * @returns {{entries: Entry[], conflicts: Conflict[]}}
 */
function collectGraphInput(input) {
  if (isRuntimeGraph(input)) {
    return {
      entries: input.entries.map(normalizeEntry),
      conflicts: input.conflicts.map(normalizeConflict),
    };
  }
  if (isPlainObject(input) && Object.hasOwn(input, '@context') && Object.hasOwn(input, '@graph')) {
    if (input['@context'] !== SCHEMA_CONTEXT && input['@context'] !== `${SCHEMA_CONTEXT}/`) {
      throw new TypeError('Schema graph context must be https://schema.org');
    }
    if (!Array.isArray(input['@graph'])) throw new TypeError('Schema graph @graph must be an array');
    return { entries: input['@graph'].map((entity) => normalizeEntry(entity)), conflicts: [] };
  }
  if (Array.isArray(input)) {
    return { entries: input.map((entry) => normalizeEntry(entry)), conflicts: [] };
  }
  return { entries: [normalizeEntry(input)], conflicts: [] };
}

/** @param {unknown} input @returns {Entry} */
function normalizeEntry(input) {
  if (isPlainObject(input) && !Object.hasOwn(input, '@type') && Object.hasOwn(input, 'entity')) {
    const entity = createEntity(input.entity);
    return {
      entity,
      roles: normalizeRoles(input.roles),
      provenance: normalizeProvenance(input.provenance),
    };
  }
  return {
    entity: createEntity(/** @type {Record<string, any>} */ (input)),
    roles: [],
    provenance: [{ source: 'api' }],
  };
}

/** @param {unknown} roles @returns {string[]} */
function normalizeRoles(roles) {
  if (roles === undefined) return [];
  const values = Array.isArray(roles) ? roles : [roles];
  /** @type {string[]} */
  const result = [];
  for (const role of values) {
    if (typeof role !== 'string' || !GRAPH_ROLES.has(role)) {
      throw new TypeError('Unknown schema graph role');
    }
    if (!result.includes(role)) result.push(role);
  }
  return result;
}

/** @param {unknown} provenance @returns {Provenance[]} */
function normalizeProvenance(provenance) {
  if (provenance === undefined) return [{ source: 'api' }];
  const values = Array.isArray(provenance) ? provenance : [provenance];
  if (values.length === 0) return [{ source: 'api' }];
  return values.map((item) => {
    if (!isPlainObject(item) || typeof item.source !== 'string' || !PROVENANCE_SOURCES.has(item.source)) {
      throw new TypeError('Unknown schema graph provenance source');
    }
    /** @type {Provenance} */
    const normalized = { source: item.source };
    if (item.pointer !== undefined) {
      if (typeof item.pointer !== 'string' || (item.pointer !== '' && !item.pointer.startsWith('/'))) {
        throw new TypeError('Graph provenance pointer must be an RFC 6901 pointer');
      }
      normalized.pointer = item.pointer;
    }
    for (const key of ['pathname', 'sourcePath', 'plugin']) {
      if (item[key] === undefined) continue;
      normalized[key] = requireString(item[key], `Graph provenance ${key}`);
    }
    return normalized;
  });
}

/** @param {unknown} value @returns {Conflict} */
function normalizeConflict(value) {
  if (!isPlainObject(value)) throw new TypeError('Graph conflict must be a plain object');
  const policy = normalizeConflictPolicy(value.policy);
  const resolution = value.resolution;
  if (resolution !== 'unresolved' && resolution !== 'first' && resolution !== 'last') {
    throw new TypeError('Graph conflict resolution is invalid');
  }
  const conflict = /** @type {Conflict} */ ({
    pointer: requireString(value.pointer, 'Graph conflict pointer'),
    policy,
    resolution,
    first: normalizeProvenance(value.first),
    incoming: normalizeProvenance(value.incoming),
  });
  if (value.entityId !== undefined) conflict.entityId = requireString(value.entityId, 'Graph conflict ID');
  if (value.role !== undefined) {
    const [role] = normalizeRoles(value.role);
    conflict.role = role;
  }
  return conflict;
}

/**
 * @param {Entry[]} inputs
 * @param {ConflictPolicy} policy
 * @param {Conflict[]} initialConflicts
 * @returns {RuntimeGraph}
 */
function mergeEntries(inputs, policy, initialConflicts = []) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Conflict[]} */
  const conflicts = initialConflicts.map(normalizeConflict);
  /** @type {Map<string, number>} */
  const ids = new Map();

  for (const rawEntry of inputs) {
    const incoming = normalizeEntry(rawEntry);
    incoming.entity = deduplicateValue(
      incoming.entity,
      '',
      policy,
      conflicts,
      incoming.provenance,
      entityId(incoming.entity),
    );
    const id = entityId(incoming.entity);
    let index = id === undefined ? -1 : (ids.get(id) ?? -1);
    let adoptedRole;

    if (index < 0) {
      const singleton = singletonMatch(entries, incoming);
      index = singleton.index;
      adoptedRole = singleton.role;
    }
    if (index < 0 && id === undefined) {
      index = entries.findIndex((entry) => deepEqual(entry.entity, incoming.entity));
    }

    if (index < 0) {
      entries.push(incoming);
      if (id !== undefined) ids.set(id, entries.length - 1);
      continue;
    }

    const existing = entries[index];
    const existingId = entityId(existing.entity);
    const incomingId = entityId(incoming.entity);
    const existingInferred = isInferenceOnly(existing.provenance);
    const incomingInferred = isInferenceOnly(incoming.provenance);
    let chosenId = existingId;
    if (existingInferred && !incomingInferred && incomingId !== undefined) chosenId = incomingId;
    if (!existingInferred && incomingInferred && existingId !== undefined) chosenId = existingId;
    if (chosenId === undefined) chosenId = incomingId;

    const firstEntity = chosenId === existingId
      ? existing.entity
      : { ...existing.entity, '@id': chosenId };
    const nextEntity = chosenId === incomingId
      ? incoming.entity
      : { ...incoming.entity, '@id': chosenId };
    const mergedEntity = mergeValues(
      firstEntity,
      nextEntity,
      '',
      policy,
      conflicts,
      existing.provenance,
      incoming.provenance,
      chosenId,
      adoptedRole,
    );
    entries[index] = {
      entity: mergedEntity,
      roles: orderedUnique([...existing.roles, ...incoming.roles]),
      provenance: uniqueProvenance([...existing.provenance, ...incoming.provenance]),
    };
    if (existingId !== undefined && existingId !== chosenId) ids.delete(existingId);
    if (incomingId !== undefined && incomingId !== chosenId) ids.delete(incomingId);
    if (chosenId !== undefined) ids.set(chosenId, index);
  }

  return { version: GRAPH_VERSION, entries, conflicts };
}

/**
 * Deduplicate arrays already present inside one entity.
 * @param {any} value
 * @param {string} pointer
 * @param {ConflictPolicy} policy
 * @param {Conflict[]} conflicts
 * @param {Provenance[]} provenance
 * @param {string | undefined} id
 * @returns {any}
 */
function deduplicateValue(value, pointer, policy, conflicts, provenance, id) {
  if (Array.isArray(value)) {
    /** @type {any[]} */
    const result = [];
    for (const rawItem of value) {
      const item = deduplicateValue(rawItem, `${pointer}/${result.length}`, policy, conflicts, provenance, id);
      const itemId = isPlainObject(item) && typeof item['@id'] === 'string' ? item['@id'] : undefined;
      const index = result.findIndex((current) => {
        if (itemId !== undefined && isPlainObject(current)) return current['@id'] === itemId;
        return deepEqual(current, item);
      });
      if (index < 0) {
        result.push(item);
      } else if (itemId !== undefined && isPlainObject(result[index])) {
        result[index] = mergeValues(
          result[index],
          item,
          `${pointer}/${index}`,
          policy,
          conflicts,
          provenance,
          provenance,
          id,
          undefined,
        );
      }
    }
    return result;
  }
  if (!isPlainObject(value)) return value;
  /** @type {Record<string, any>} */
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = deduplicateValue(child, childPointer(pointer, key), policy, conflicts, provenance, id);
  }
  return result;
}

/**
 * @param {any} first
 * @param {any} incoming
 * @param {string} pointer
 * @param {ConflictPolicy} policy
 * @param {Conflict[]} conflicts
 * @param {Provenance[]} firstProvenance
 * @param {Provenance[]} incomingProvenance
 * @param {string | undefined} id
 * @param {string | undefined} role
 * @returns {any}
 */
function mergeValues(
  first,
  incoming,
  pointer,
  policy,
  conflicts,
  firstProvenance,
  incomingProvenance,
  id,
  role,
) {
  if (deepEqual(first, incoming)) return cloneJson(first, pointer, new Set());
  if (pointer === '/@type') return mergeTypes(first, incoming);

  if (isPlainObject(first) && isPlainObject(incoming)) {
    /** @type {Record<string, any>} */
    const result = {};
    for (const key of Object.keys(first)) result[key] = cloneJson(first[key], childPointer(pointer, key), new Set());
    for (const key of Object.keys(incoming)) {
      const nextPointer = childPointer(pointer, key);
      result[key] = Object.hasOwn(result, key)
        ? mergeValues(
            result[key],
            incoming[key],
            nextPointer,
            policy,
            conflicts,
            firstProvenance,
            incomingProvenance,
            id,
            role,
          )
        : cloneJson(incoming[key], nextPointer, new Set());
    }
    return result;
  }

  if (Array.isArray(first) && Array.isArray(incoming)) {
    return mergeArrays(
      first,
      incoming,
      pointer,
      policy,
      conflicts,
      firstProvenance,
      incomingProvenance,
      id,
      role,
    );
  }

  const firstIsInference = isInferenceOnly(provenanceAt(firstProvenance, pointer));
  const incomingIsInference = isInferenceOnly(provenanceAt(incomingProvenance, pointer));
  if (firstIsInference !== incomingIsInference) {
    return firstIsInference
      ? cloneJson(incoming, pointer, new Set())
      : cloneJson(first, pointer, new Set());
  }

  conflicts.push({
    ...(id === undefined ? {} : { entityId: id }),
    ...(role === undefined ? {} : { role }),
    pointer: pointer || '',
    policy,
    resolution: policy === 'error' ? 'unresolved' : policy,
    first: firstProvenance.map(cloneProvenance),
    incoming: incomingProvenance.map(cloneProvenance),
  });
  return cloneJson(policy === 'last' ? incoming : first, pointer, new Set());
}

/**
 * @param {any[]} first
 * @param {any[]} incoming
 * @param {string} pointer
 * @param {ConflictPolicy} policy
 * @param {Conflict[]} conflicts
 * @param {Provenance[]} firstProvenance
 * @param {Provenance[]} incomingProvenance
 * @param {string | undefined} id
 * @param {string | undefined} role
 * @returns {any[]}
 */
function mergeArrays(
  first,
  incoming,
  pointer,
  policy,
  conflicts,
  firstProvenance,
  incomingProvenance,
  id,
  role,
) {
  const result = first.map((value, index) => cloneJson(value, `${pointer}/${index}`, new Set()));
  for (const value of incoming) {
    const valueId = isPlainObject(value) && typeof value['@id'] === 'string' ? value['@id'] : undefined;
    const index = result.findIndex((current) => {
      if (valueId !== undefined && isPlainObject(current)) return current['@id'] === valueId;
      return deepEqual(current, value);
    });
    if (index < 0) {
      result.push(cloneJson(value, `${pointer}/${result.length}`, new Set()));
      continue;
    }
    if (valueId !== undefined && isPlainObject(result[index]) && isPlainObject(value)) {
      result[index] = mergeValues(
        result[index],
        value,
        `${pointer}/${index}`,
        policy,
        conflicts,
        firstProvenance,
        incomingProvenance,
        id,
        role,
      );
    }
  }
  return result;
}

/** @param {Entry[]} entries @param {Entry} incoming @returns {{index: number, role?: string}} */
function singletonMatch(entries, incoming) {
  const incomingInference = isInferenceOnly(incoming.provenance);
  for (const role of incoming.roles) {
    if (!SINGLETON_ROLES.has(role)) continue;
    const index = entries.findIndex((entry) => entry.roles.includes(role) && compatibleTypes(entry.entity, incoming.entity));
    if (index < 0) continue;
    const existingInference = isInferenceOnly(entries[index].provenance);
    if (existingInference || incomingInference) return { index, role };
  }
  return { index: -1 };
}

/** @param {Record<string, any>} first @param {Record<string, any>} second */
function compatibleTypes(first, second) {
  const left = normalizeTypes(first['@type']);
  const right = normalizeTypes(second['@type']);
  return left.some((type) => right.includes(type));
}

/** @param {unknown} first @param {unknown} second @returns {string | string[]} */
function mergeTypes(first, second) {
  const types = orderedUnique([...normalizeTypes(first), ...normalizeTypes(second)]);
  return types.length === 1 ? types[0] : types;
}

/** @param {unknown} value @returns {string[]} */
function normalizeTypes(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item) => typeof item === 'string');
}

/** @param {Entry[]} entries @param {Finding[]} findings */
function validateSingletonRoles(entries, findings) {
  for (const role of SINGLETON_ROLES) {
    const claimants = entries.filter((entry) => entry.roles.includes(role));
    if (claimants.length < 2) continue;
    findings.push(
      finding('schema.duplicate-role', 'error', `Multiple graph entities claim the singleton ${role} role`),
    );
  }
}

/**
 * @param {Entry[]} entries
 * @param {string | undefined} documentCanonical
 * @param {Finding[]} findings
 */
function validateUrlProperties(entries, documentCanonical, findings) {
  for (const entry of entries) walkUrls(entry.entity, '', documentCanonical, findings);
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {string | undefined} documentCanonical
 * @param {Finding[]} findings
 */
function walkUrls(value, pointer, documentCanonical, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkUrls(item, `${pointer}/${index}`, documentCanonical, findings));
    return;
  }
  if (!isPlainObject(value)) return;
  if (normalizeTypes(value['@type']).includes('URL') && Object.hasOwn(value, '@value')) {
    validateUrlValue(value['@value'], childPointer(pointer, '@value'), documentCanonical, findings);
  }
  for (const [key, item] of Object.entries(value)) {
    const nextPointer = childPointer(pointer, key);
    if (URL_PROPERTIES.has(key)) validateUrlValue(item, nextPointer, documentCanonical, findings);
    if (URL_OR_TEXT_PROPERTIES.has(key)) {
      validateUrlLikeValue(item, nextPointer, documentCanonical, findings);
    }
    walkUrls(item, nextPointer, documentCanonical, findings);
  }
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {string | undefined} base
 * @param {Finding[]} findings
 */
function validateUrlValue(value, pointer, base, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateUrlValue(item, `${pointer}/${index}`, base, findings));
    return;
  }
  if (typeof value !== 'string') return;
  try {
    const parsed = base === undefined ? new URL(value) : new URL(value, base);
    assertSafeUrl(parsed, 'Schema URL');
  } catch {
    findings.push(finding('schema.unsafe-url', 'error', 'Schema URL is invalid or unsafe', { pointer }));
  }
}

/**
 * Validate URL-shaped values for Schema.org properties that also accept Text.
 * Plain text is deliberately ignored, including text containing whitespace
 * after a word that happens to end in a colon.
 *
 * @param {unknown} value
 * @param {string} pointer
 * @param {string | undefined} base
 * @param {Finding[]} findings
 */
function validateUrlLikeValue(value, pointer, base, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateUrlLikeValue(item, `${pointer}/${index}`, base, findings));
    return;
  }
  if (typeof value !== 'string' || !looksLikeUrl(value)) return;
  validateUrlValue(value, pointer, base, findings);
}

/** @param {string} value */
function looksLikeUrl(value) {
  const text = value.trim();
  if (text === '' || /\s/.test(text)) return false;
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|\.\/|\.\.\/|#|\?)/i.test(text);
}

/**
 * @param {Entry[]} entries
 * @param {string | undefined} documentCanonical
 * @param {string | undefined} siteUrl
 * @param {Set<string> | undefined} knownIds
 * @param {boolean} strict
 * @param {Finding[]} findings
 */
function validateReferences(entries, documentCanonical, siteUrl, knownIds, strict, findings) {
  const definitions = new Set();
  /** @type {{id: string, pointer: string}[]} */
  const references = [];
  for (const [entryIndex, entry] of entries.entries()) {
    collectReferences(entry.entity, `/entries/${entryIndex}/entity`, true, definitions, references);
  }
  const documentKey = documentCanonical === undefined ? undefined : documentIdentity(documentCanonical);
  const site = siteUrl === undefined ? undefined : new URL(siteUrl);
  for (const reference of references) {
    if (definitions.has(reference.id)) continue;
    let parsed;
    try {
      parsed = documentCanonical === undefined ? new URL(reference.id) : new URL(reference.id, documentCanonical);
      assertSafeUrl(parsed, 'Schema reference');
    } catch {
      findings.push(
        finding('schema.invalid-reference', 'error', 'Schema reference is invalid or unsafe', {
          pointer: reference.pointer,
        }),
      );
      continue;
    }
    const normalized = parsed.href;
    if (definitions.has(normalized)) continue;
    const sameDocument = documentKey !== undefined && documentIdentity(normalized) === documentKey;
    const sameSite = site !== undefined && isWithinSite(parsed, site);
    if (!sameDocument && (!sameSite || knownIds === undefined)) continue;
    if (sameSite && knownIds?.has(normalized)) continue;
    findings.push(
      finding(
        'schema.unresolved-reference',
        strict ? 'error' : 'warning',
        sameDocument
          ? 'Same-document schema reference does not resolve'
          : 'Known same-site schema reference does not resolve',
        { entityId: normalized, pointer: reference.pointer },
      ),
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {boolean} topLevel
 * @param {Set<string>} definitions
 * @param {{id: string, pointer: string}[]} references
 */
function collectReferences(value, pointer, topLevel, definitions, references) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, `${pointer}/${index}`, false, definitions, references));
    return;
  }
  if (!isPlainObject(value)) return;
  const id = typeof value['@id'] === 'string' ? value['@id'] : undefined;
  const definition = topLevel || Object.hasOwn(value, '@type') || Object.keys(value).some((key) => key !== '@id');
  if (id !== undefined) {
    if (definition) definitions.add(id);
    else references.push({ id, pointer: childPointer(pointer, '@id') });
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '@id') continue;
    collectReferences(item, childPointer(pointer, key), false, definitions, references);
  }
}

/**
 * @param {Record<string, any>} entity
 * @param {string | undefined} base
 * @param {Finding[]} findings
 * @returns {Record<string, any>}
 */
function normalizeEntityIds(entity, base, findings) {
  return /** @type {Record<string, any>} */ (mapJson(entity, '', (value, pointer, key) => {
    if (key !== '@id' || typeof value !== 'string') return value;
    try {
      return createId(value, base);
    } catch {
      findings.push(finding('schema.invalid-id', 'error', 'Schema ID is invalid or unsafe', { pointer }));
      return value;
    }
  }));
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {(value: unknown, pointer: string, key?: string) => unknown} transform
 * @param {string} [key]
 * @returns {unknown}
 */
function mapJson(value, pointer, transform, key) {
  const transformed = transform(value, pointer, key);
  if (Array.isArray(transformed)) {
    return transformed.map((item, index) => mapJson(item, `${pointer}/${index}`, transform));
  }
  if (!isPlainObject(transformed)) return transformed;
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const [childKey, child] of Object.entries(transformed)) {
    const nextPointer = childPointer(pointer, childKey);
    result[childKey] = mapJson(child, nextPointer, transform, childKey);
  }
  return result;
}

/**
 * @param {readonly string[] | undefined} ids
 * @param {string | undefined} base
 * @param {Finding[]} findings
 * @returns {Set<string> | undefined}
 */
function normalizeKnownIds(ids, base, findings) {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) {
    findings.push(finding('schema.invalid-known-ids', 'error', 'Known entity IDs must be an array'));
    return new Set();
  }
  const result = new Set();
  for (const id of ids) {
    try {
      result.add(createId(id, base));
    } catch {
      findings.push(finding('schema.invalid-known-id', 'error', 'Known entity ID is invalid or unsafe'));
    }
  }
  return result;
}

/**
 * @param {string | URL | undefined} value
 * @param {string} label
 * @param {Finding[]} findings
 * @returns {string | undefined}
 */
function normalizeOptionalAbsoluteUrl(value, label, findings) {
  if (value === undefined) return undefined;
  try {
    return createId(value);
  } catch {
    findings.push(finding('schema.invalid-validation-url', 'error', `${label} is invalid or unsafe`));
    return undefined;
  }
}

/** @param {Record<string, any>} entity @returns {string | undefined} */
function entityId(entity) {
  return typeof entity['@id'] === 'string' ? entity['@id'] : undefined;
}

/** @param {Provenance[]} provenance @param {string} pointer @returns {Provenance[]} */
function provenanceAt(provenance, pointer) {
  const selected = provenance.filter((item) => {
    if (item.pointer === undefined || item.pointer === '') return true;
    return pointer === item.pointer || pointer.startsWith(`${item.pointer}/`);
  });
  return selected.length === 0 ? provenance : selected;
}

/** @param {Provenance[]} provenance */
function isInferenceOnly(provenance) {
  return provenance.length > 0 && provenance.every((item) => item.source === 'inference');
}

/** @param {Provenance[]} values @returns {Provenance[]} */
function uniqueProvenance(values) {
  /** @type {Provenance[]} */
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = JSON.stringify(sortJson(value));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneProvenance(value));
  }
  return result;
}

/** @param {Provenance} value @returns {Provenance} */
function cloneProvenance(value) {
  return { ...value };
}

/** @param {unknown} value @returns {value is RuntimeGraph} */
function isRuntimeGraph(value) {
  return (
    isPlainObject(value) &&
    !Object.hasOwn(value, '@type') &&
    value.version === GRAPH_VERSION &&
    Array.isArray(value.entries) &&
    Array.isArray(value.conflicts)
  );
}

/** @returns {RuntimeGraph} */
function emptyGraph() {
  return { version: GRAPH_VERSION, entries: [], conflicts: [] };
}

/** @param {ConflictPolicy | undefined} policy @returns {ConflictPolicy} */
function normalizeConflictPolicy(policy) {
  const value = policy ?? 'error';
  if (value !== 'error' && value !== 'first' && value !== 'last') {
    throw new TypeError('Graph conflict policy must be "error", "first", or "last"');
  }
  return value;
}

/** @param {unknown} value */
function assertEntityType(value) {
  const type = value?.['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (
    types.length === 0 ||
    types.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new TypeError('Schema entity requires a non-empty @type');
  }
}

/** @param {unknown} value @param {string} pointer */
function assertIdText(value, pointer) {
  if (typeof value !== 'string' || value.trim() === '' || hasControl(value)) {
    throw new TypeError(`Schema ID at ${pointer} must be a non-empty string`);
  }
  const scheme = schemeOf(value);
  if (scheme !== undefined && DANGEROUS_SCHEMES.has(scheme)) {
    throw new TypeError(`Schema ID at ${pointer} uses an unsafe scheme`);
  }
}

/** @param {URL} url @param {string} label */
function assertSafeUrl(url, label) {
  if (DANGEROUS_SCHEMES.has(url.protocol.toLowerCase())) {
    throw new TypeError(`${label} uses an unsafe scheme`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${label} must not contain credentials`);
  }
  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    isLoopbackHostname(url.hostname)
  ) {
    throw new TypeError(`${label} must not use a loopback host`);
  }
  if (hasControl(url.href)) throw new TypeError(`${label} contains control characters`);
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {Set<object>} ancestors
 * @returns {any}
 */
function cloneJson(value, pointer, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${pointer || '/'}`);
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`Cyclic schema value at ${pointer || '/'}`);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`Symbol schema key at ${pointer || '/'}`);
    }
    const extraKeys = Object.getOwnPropertyNames(value).filter(
      (key) => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key),
    );
    if (extraKeys.length > 0) throw new TypeError(`Non-JSON schema array key at ${pointer || '/'}`);
    ancestors.add(value);
    const result = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`Sparse schema array at ${pointer || '/'}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        throw new TypeError(`Schema accessor is not allowed at ${pointer}/${index}`);
      }
      result.push(cloneJson(descriptor?.value, `${pointer}/${index}`, ancestors));
    }
    ancestors.delete(value);
    return result;
  }
  if (!isPlainObject(value)) throw new TypeError(`Non-JSON schema value at ${pointer || '/'}`);
  if (ancestors.has(value)) throw new TypeError(`Cyclic schema value at ${pointer || '/'}`);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Symbol schema key at ${pointer || '/'}`);
  }
  if (
    Object.getOwnPropertyNames(value).some(
      (key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true,
    )
  ) {
    throw new TypeError(`Non-enumerable schema value at ${pointer || '/'}`);
  }
  ancestors.add(value);
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of Object.keys(value)) {
    requireSafeKey(key, `Schema key at ${pointer || '/'}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
      throw new TypeError(`Schema accessor is not allowed at ${childPointer(pointer, key)}`);
    }
    if (descriptor?.enumerable !== true) {
      throw new TypeError(`Non-enumerable schema value at ${childPointer(pointer, key)}`);
    }
    result[key] = cloneJson(descriptor?.value, childPointer(pointer, key), ancestors);
  }
  ancestors.delete(value);
  return result;
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {string} key @param {string} label */
function requireSafeKey(key, label) {
  if (typeof key !== 'string' || key === '' || FORBIDDEN_KEYS.has(key) || hasControl(key)) {
    throw new TypeError(`${label} is invalid`);
  }
}

/** @param {unknown} value @param {string} label @returns {string} */
function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || hasControl(value)) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

/** @param {string} value @returns {boolean} */
function hasControl(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** @param {string} value @returns {string | undefined} */
function schemeOf(value) {
  const match = /^([a-z][a-z\d+.-]*):/i.exec(value.trim());
  return match?.[1] === undefined ? undefined : `${match[1].toLowerCase()}:`;
}

/** @param {unknown} value @returns {unknown} */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value).sort((left, right) => {
    const leftRank = left === '@id' ? 0 : left === '@type' ? 1 : 2;
    const rightRank = right === '@id' ? 0 : right === '@type' ? 1 : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const key of keys) result[key] = sortJson(value[key]);
  return result;
}

/** @param {unknown} first @param {unknown} second @returns {boolean} */
function deepEqual(first, second) {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => deepEqual(value, second[index]));
  }
  if (isPlainObject(first) && isPlainObject(second)) {
    const left = Object.keys(first);
    const right = Object.keys(second);
    return (
      left.length === right.length &&
      left.every((key) => Object.hasOwn(second, key) && deepEqual(first[key], second[key]))
    );
  }
  return false;
}

/** @param {unknown} value @param {{'@id': string}} reference */
function isSameReference(value, reference) {
  return isPlainObject(value) && value['@id'] === reference['@id'];
}

/** @param {string[]} values @returns {string[]} */
function orderedUnique(values) {
  return [...new Set(values)];
}

/** @param {string} pointer @param {string} key @returns {string} */
function childPointer(pointer, key) {
  const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1');
  return `${pointer}/${escaped}`;
}

/** @param {string} value @returns {string} */
function documentIdentity(value) {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

/** @param {URL} candidate @param {URL} site */
function isWithinSite(candidate, site) {
  if (candidate.origin !== site.origin) return false;
  const base = site.pathname.endsWith('/') ? site.pathname : `${site.pathname}/`;
  return candidate.pathname === site.pathname || candidate.pathname.startsWith(base);
}

/**
 * @param {string} code
 * @param {'info' | 'warning' | 'error'} severity
 * @param {string} message
 * @param {{entityId?: string, pointer?: string, pathname?: string}} [location]
 * @returns {Finding}
 */
function finding(code, severity, message, location = {}) {
  return { version: GRAPH_VERSION, code, severity, message, ...location };
}
