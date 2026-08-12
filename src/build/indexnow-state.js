// @ts-check
import { createHash } from 'node:crypto';

export const INDEXNOW_STATE_VERSION = 1;
export const INDEXNOW_QUEUE_VERSION = 1;
export const INDEXNOW_ACK_VERSION = 1;
export const INDEXNOW_PREPARE_INPUT_VERSION = 1;
export const INDEXNOW_PUBLIC_FILENAME = 'astro-aeo-indexnow-v1.json';
export const INDEXNOW_PENDING_FILENAME = 'pending-v1.json';
export const INDEXNOW_ACK_FILENAME = 'ack-v1.json';
export const INDEXNOW_PREPARE_INPUT_FILENAME = 'prepare-input-v1.json';

/** @typedef {{ url: string; fingerprint: `sha256:${string}` }} UrlFingerprint */
/** @typedef {'upsert'|'remove'} IndexNowOperationKind */
/** @typedef {{ url: string; operation: IndexNowOperationKind; fingerprint?: `sha256:${string}` }} IndexNowOperation */
/** @typedef {{ source: 'env'; name?: string } | { source: 'file'; path: string }} IndexNowKeySource */
/** @typedef {{ origin: string; key?: IndexNowKeySource; keyLocation?: string; targetDigest?: `sha256:${string}` }} IndexNowOriginConfig */
/**
 * @typedef {{
 *   version: 1;
 *   projectRoot: string;
 *   mode: 'public'|'private'|'stateless';
 *   submit: 'changed'|'all';
 *   strict: boolean;
 *   base: string;
 *   statePathname: string;
 *   key: IndexNowKeySource;
 *   keyLocation?: string;
 *   origins: IndexNowOriginConfig[];
 *   current: UrlFingerprint[];
 * }} IndexNowPrepareInputV1
 */
/**
 * @typedef {{
 *   version: 1;
 *   origins: Array<{
 *     origin: string;
 *     mode: 'public'|'private'|'stateless';
 *     strict: boolean;
 *     stateUrl?: string;
 *     targetDigest: `sha256:${string}`;
 *     key: IndexNowKeySource;
 *     keyLocation?: string;
 *     operations: IndexNowOperation[];
 *   }>;
 * }} IndexNowQueueV1
 */
/**
 * @typedef {{
 *   version: 1;
 *   origins: Array<{ origin: string; acknowledged: UrlFingerprint[] }>;
 * }} IndexNowAcknowledgmentV1
 */

/**
 * Create a deterministic page fingerprint from the public semantic state. A
 * caller may pass richer fields in `metadata`; sorted object keys make them
 * stable while meaningful array order remains intact.
 * @param {{
 *   canonicalUrl: string;
 *   markdown: string;
 *   metadata?: unknown;
 *   directives?: unknown;
 *   locale?: string | null;
 *   language?: string | null;
 *   alternates?: unknown[];
 *   graph?: unknown;
 * }} page
 * @returns {`sha256:${string}`}
 */
export function fingerprintIndexNowPage(page) {
  return sha256(canonicalJson({
    canonicalUrl: page.canonicalUrl,
    markdown: normalizeLf(page.markdown),
    metadata: page.metadata ?? null,
    directives: page.directives ?? null,
    locale: page.locale ?? null,
    language: page.language ?? null,
    alternates: page.alternates ?? [],
    graph: page.graph ?? null,
  }));
}

/**
 * Create one host-local, key-free public state manifest.
 * @param {string} origin
 * @param {UrlFingerprint[]} current
 * @param {UrlFingerprint[]} acknowledged
 */
export function createIndexNowStateManifest(origin, current, acknowledged) {
  const canonicalOrigin = normalizeOrigin(origin);
  const currentUrls = normalizeFingerprints(current, canonicalOrigin);
  const acknowledgedUrls = normalizeFingerprints(acknowledged, canonicalOrigin);
  const withoutDigest = {
    version: INDEXNOW_STATE_VERSION,
    origin: canonicalOrigin,
    current: { digest: sha256(canonicalJson(currentUrls)), urls: currentUrls },
    acknowledged: { digest: sha256(canonicalJson(acknowledgedUrls)), urls: acknowledgedUrls },
  };
  return { ...withoutDigest, digest: sha256(canonicalJson(withoutDigest)) };
}

/** @param {ReturnType<typeof createIndexNowStateManifest>} manifest */
export function serializeIndexNowStateManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Strictly decode a public state manifest without accepting keys, paths, or
 * other attacker-controlled configuration from a deployed origin.
 * @param {unknown} value
 * @param {string} expectedOrigin
 * @returns {ReturnType<typeof createIndexNowStateManifest>}
 */
export function parseIndexNowStateManifest(value, expectedOrigin) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.origin !== 'string' ||
    !isSha256(value.digest) ||
    Object.keys(value).some((key) => !['version', 'origin', 'current', 'acknowledged', 'digest'].includes(key))
  ) {
    throw new TypeError('IndexNow state manifest has an invalid shape');
  }
  if (value.origin !== normalizeOrigin(expectedOrigin)) throw new TypeError('IndexNow state manifest origin does not match');
  const current = parseStateSet(value.current, 'current', value.origin);
  const acknowledged = parseStateSet(value.acknowledged, 'acknowledged', value.origin);
  const expected = createIndexNowStateManifest(value.origin, current, acknowledged);
  if (value.digest !== expected.digest) throw new TypeError('IndexNow state manifest digest does not match');
  return expected;
}

/**
 * Build current public state plus the pending operation set for one origin.
 * `priorPending` is intentionally folded back into the desired-state diff, so
 * a later build always replaces stale operations with the newest intention.
 * @param {{
 *   origin: string;
 *   current: UrlFingerprint[];
 *   acknowledged?: UrlFingerprint[];
 *   mode: 'public'|'private'|'stateless';
 *   submit: 'changed'|'all';
 *   priorPending?: IndexNowOperation[];
 * }} input
 */
export function prepareIndexNowOrigin(input) {
  const origin = normalizeOrigin(input.origin);
  const current = normalizeFingerprints(input.current, origin);
  const acknowledged = input.mode === 'stateless'
    ? []
    : normalizeFingerprints(input.acknowledged ?? [], origin);
  const effectiveSubmit = input.mode === 'stateless' ? 'all' : input.submit;
  /** @type {Map<string, UrlFingerprint>} */
  const currentByUrl = new Map(current.map((item) => [item.url, item]));
  /** @type {Map<string, UrlFingerprint>} */
  const ackByUrl = new Map(acknowledged.map((item) => [item.url, item]));
  /** @type {IndexNowOperation[]} */
  const operations = [];
  for (const item of current) {
    const prior = ackByUrl.get(item.url);
    if (effectiveSubmit === 'all' || !prior || prior.fingerprint !== item.fingerprint) {
      operations.push({ url: item.url, operation: 'upsert', fingerprint: item.fingerprint });
    }
  }
  if (input.mode !== 'stateless') {
    for (const item of acknowledged) {
      if (!currentByUrl.has(item.url)) operations.push({ url: item.url, operation: 'remove' });
    }
  }

  // Prior failures only survive if they still express the latest desired state.
  // The computed map wins for changed/upsert/remove decisions.
  const desired = new Map(operations.map((item) => [item.url, item]));
  for (const old of input.priorPending ?? []) {
    if (desired.has(old.url)) continue;
    const now = currentByUrl.get(old.url);
    const ack = ackByUrl.get(old.url);
    if (
      now &&
      old.operation === 'upsert' &&
      old.fingerprint === now.fingerprint &&
      ack?.fingerprint !== now.fingerprint
    ) desired.set(old.url, old);
    if (!now && input.mode !== 'stateless' && old.operation === 'remove' && ackByUrl.has(old.url)) desired.set(old.url, old);
  }
  const pending = [...desired.values()].sort(compareOperations);
  return {
    origin,
    current,
    acknowledged,
    state: createIndexNowStateManifest(origin, current, acknowledged),
    operations: pending,
    ...(input.mode === 'stateless' && input.submit === 'changed'
      ? { warning: 'IndexNow stateless mode submits every current URL; submit: "changed" is treated as "all".' }
      : {}),
  };
}

/**
 * Pure multi-origin coordinator shared by builds and `indexnow prepare`.
 * Network discovery and transactional persistence remain the caller's job.
 * @param {IndexNowPrepareInputV1} input
 * @param {{
 *   acknowledgment?: IndexNowAcknowledgmentV1;
 *   priorQueue?: IndexNowQueueV1;
 *   publicAcknowledgments?: Map<string, UrlFingerprint[]>;
 *   targetDigests?: Map<string, `sha256:${string}`>;
 * }} [state]
 */
export function prepareIndexNowQueue(input, state = {}) {
  const acknowledgment = state.acknowledgment ?? { version: 1, origins: [] };
  const priorQueue = state.priorQueue ?? { version: 1, origins: [] };
  const byOrigin = groupFingerprintsByOrigin(input.current);
  const overrides = new Map(input.origins.map((item) => [item.origin, item]));
  const allOrigins = [...new Set([
    ...byOrigin.keys(),
    ...overrides.keys(),
    ...acknowledgment.origins.map((item) => item.origin),
    ...priorQueue.origins.map((item) => item.origin),
  ])].sort(codeUnitCompare);
  /** @type {IndexNowQueueV1['origins']} */
  const queueOrigins = [];
  /** @type {IndexNowAcknowledgmentV1['origins']} */
  const acknowledgmentOrigins = [];
  /** @type {ReturnType<typeof createIndexNowStateManifest>[]} */
  const manifests = [];
  /** @type {string[]} */
  const warnings = [];

  for (const origin of allOrigins) {
    const override = overrides.get(origin) ?? { origin };
    const privateValue = acknowledgment.origins.find((item) => item.origin === origin)?.acknowledged;
    const acknowledged = input.mode === 'public'
      ? privateValue ?? state.publicAcknowledgments?.get(origin) ?? []
      : privateValue ?? [];
    const previousOperations = priorQueue.origins.find((item) => item.origin === origin)?.operations ?? [];
    const prepared = prepareIndexNowOrigin({
      origin,
      current: byOrigin.get(origin) ?? [],
      acknowledged,
      mode: input.mode,
      submit: input.submit,
      priorPending: previousOperations,
    });
    if (prepared.warning) warnings.push(prepared.warning);
    manifests.push(prepared.state);
    queueOrigins.push({
      origin,
      mode: input.mode,
      strict: input.strict,
      ...(input.mode === 'public'
        ? { stateUrl: new URL(input.statePathname, `${origin}/`).href }
        : {}),
      targetDigest: override.targetDigest ?? state.targetDigests?.get(origin) ?? prepared.state.digest,
      key: override.key ?? input.key,
      ...(override.keyLocation ?? input.keyLocation
        ? { keyLocation: override.keyLocation ?? input.keyLocation }
        : {}),
      operations: prepared.operations,
    });
    acknowledgmentOrigins.push({ origin, acknowledged: prepared.acknowledged });
  }

  return {
    queue: /** @type {IndexNowQueueV1} */ ({ version: 1, origins: queueOrigins }),
    acknowledgment: /** @type {IndexNowAcknowledgmentV1} */ ({ version: 1, origins: acknowledgmentOrigins }),
    manifests,
    warnings,
  };
}

/**
 * Apply only successfully submitted operations. This function is batch-safe:
 * callers can persist the result atomically after each accepted batch.
 * @param {UrlFingerprint[]} acknowledged
 * @param {IndexNowOperation[]} successful
 * @param {string} origin
 */
export function acknowledgeIndexNowOperations(acknowledged, successful, origin) {
  const values = new Map(normalizeFingerprints(acknowledged, normalizeOrigin(origin)).map((item) => [item.url, item]));
  for (const operation of successful) {
    if (operation.operation === 'remove') values.delete(operation.url);
    else if (operation.fingerprint) values.set(operation.url, { url: operation.url, fingerprint: operation.fingerprint });
  }
  return [...values.values()].sort(compareFingerprints);
}

/** @param {IndexNowQueueV1} queue */
export function serializeIndexNowQueue(queue) {
  return `${JSON.stringify(queue, null, 2)}\n`;
}

/** @param {IndexNowAcknowledgmentV1} ack */
export function serializeIndexNowAcknowledgment(ack) {
  return `${JSON.stringify(ack, null, 2)}\n`;
}

/** @param {IndexNowPrepareInputV1} input */
export function serializeIndexNowPrepareInput(input) {
  return `${JSON.stringify(input, null, 2)}\n`;
}

/** @param {unknown} value @returns {IndexNowPrepareInputV1} */
export function parseIndexNowPrepareInput(value) {
  if (!isRecord(value) || value.version !== 1) throw new TypeError('IndexNow prepare input has an invalid version');
  assertOnlyKeys(value, [
    'version', 'projectRoot', 'mode', 'submit', 'strict', 'base', 'statePathname',
    'key', 'keyLocation', 'origins', 'current',
  ], 'IndexNow prepare input');
  const mode = enumValue(value.mode, ['public', 'private', 'stateless'], 'mode');
  const submit = enumValue(value.submit, ['changed', 'all'], 'submit');
  if (typeof value.projectRoot !== 'string' || !value.projectRoot || value.projectRoot.includes('\0')) {
    throw new TypeError('IndexNow prepare input projectRoot is required');
  }
  if (typeof value.strict !== 'boolean' || typeof value.base !== 'string' || typeof value.statePathname !== 'string') {
    throw new TypeError('IndexNow prepare input metadata is invalid');
  }
  const base = normalizePrepareBase(value.base);
  const statePathname = validateRootPath(value.statePathname, 'statePathname');
  if (statePathname !== `${base}/.well-known/${INDEXNOW_PUBLIC_FILENAME}`) {
    throw new TypeError('IndexNow statePathname does not match the configured base');
  }
  const key = parseKeySource(value.key);
  const origins = parseOriginConfigs(value.origins);
  const current = parseFingerprints(value.current, undefined);
  if (value.keyLocation !== undefined && typeof value.keyLocation !== 'string') {
    throw new TypeError('IndexNow keyLocation must be a string');
  }
  return {
    version: 1,
    projectRoot: value.projectRoot,
    mode,
    submit,
    strict: value.strict,
    base,
    statePathname,
    key,
    ...(value.keyLocation === undefined ? {} : { keyLocation: validateRootPath(value.keyLocation, 'keyLocation') }),
    origins,
    current,
  };
}

/** @param {unknown} value @returns {IndexNowQueueV1} */
export function parseIndexNowQueue(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.origins)) {
    throw new TypeError('IndexNow queue has an invalid shape');
  }
  assertOnlyKeys(value, ['version', 'origins'], 'IndexNow queue');
  const seenOrigins = new Set();
  const origins = value.origins.map((item) => {
    if (!isRecord(item)) throw new TypeError('IndexNow queue origin is invalid');
    assertOnlyKeys(item, [
      'origin', 'mode', 'strict', 'stateUrl', 'targetDigest', 'key', 'keyLocation', 'operations',
    ], 'IndexNow queue origin');
    const origin = normalizeOrigin(String(item.origin ?? ''));
    if (seenOrigins.has(origin)) throw new TypeError(`Duplicate IndexNow queue origin ${origin}`);
    seenOrigins.add(origin);
    const mode = enumValue(item.mode, ['public', 'private', 'stateless'], 'mode');
    if (typeof item.strict !== 'boolean' || !isSha256(item.targetDigest)) throw new TypeError('IndexNow queue metadata is invalid');
    const operations = parseOperations(item.operations, origin);
    const stateUrl = item.stateUrl === undefined ? undefined : validateSameOriginUrl(String(item.stateUrl), origin);
    if (mode === 'public' && !stateUrl) throw new TypeError('Public IndexNow queue origin requires a state URL');
    if (mode !== 'public' && stateUrl) throw new TypeError('Only a public IndexNow queue origin may include a state URL');
    return {
      origin,
      mode,
      strict: item.strict,
      ...(stateUrl ? { stateUrl } : {}),
      targetDigest: /** @type {`sha256:${string}`} */ (item.targetDigest),
      key: parseKeySource(item.key),
      ...(item.keyLocation === undefined ? {} : { keyLocation: validateRootPath(String(item.keyLocation), 'keyLocation') }),
      operations,
    };
  });
  origins.sort((a, b) => codeUnitCompare(a.origin, b.origin));
  return { version: 1, origins };
}

/** @param {unknown} value @returns {IndexNowAcknowledgmentV1} */
export function parseIndexNowAcknowledgment(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.origins)) {
    throw new TypeError('IndexNow acknowledgment ledger has an invalid shape');
  }
  assertOnlyKeys(value, ['version', 'origins'], 'IndexNow acknowledgment ledger');
  const seenOrigins = new Set();
  const origins = value.origins.map((item) => {
    if (!isRecord(item)) throw new TypeError('IndexNow acknowledgment origin is invalid');
    assertOnlyKeys(item, ['origin', 'acknowledged'], 'IndexNow acknowledgment origin');
    const origin = normalizeOrigin(String(item.origin ?? ''));
    if (seenOrigins.has(origin)) throw new TypeError(`Duplicate IndexNow acknowledgment origin ${origin}`);
    seenOrigins.add(origin);
    return { origin, acknowledged: parseFingerprints(item.acknowledged, origin) };
  });
  origins.sort((a, b) => codeUnitCompare(a.origin, b.origin));
  return { version: 1, origins };
}

/** @param {unknown} value @returns {IndexNowKeySource} */
export function parseKeySource(value) {
  if (!isRecord(value)) throw new TypeError('IndexNow key source is invalid');
  if (value.source === 'env') {
    assertOnlyKeys(value, ['source', 'name'], 'IndexNow environment key source');
    const name = value.name === undefined ? 'ASTRO_AEO_INDEXNOW_KEY' : value.name;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError('IndexNow environment name is invalid');
    return { source: 'env', name };
  }
  if (value.source === 'file' && typeof value.path === 'string' && value.path && !value.path.includes('\0')) {
    assertOnlyKeys(value, ['source', 'path'], 'IndexNow file key source');
    return { source: 'file', path: value.path };
  }
  throw new TypeError('IndexNow key source must use env or file');
}

/** @param {unknown} value @returns {IndexNowOriginConfig[]} */
function parseOriginConfigs(value) {
  if (!Array.isArray(value)) throw new TypeError('IndexNow origins must be an array');
  const seen = new Set();
  return value.map((item) => {
    if (!isRecord(item)) throw new TypeError('IndexNow origin override is invalid');
    assertOnlyKeys(item, ['origin', 'key', 'keyLocation', 'targetDigest'], 'IndexNow origin override');
    const origin = normalizeOrigin(String(item.origin ?? ''));
    if (seen.has(origin)) throw new TypeError(`Duplicate IndexNow origin ${origin}`);
    seen.add(origin);
    return {
      origin,
      ...(item.key === undefined ? {} : { key: parseKeySource(item.key) }),
      ...(item.keyLocation === undefined ? {} : { keyLocation: validateRootPath(String(item.keyLocation), 'keyLocation') }),
      ...(item.targetDigest === undefined
        ? {}
        : isSha256(item.targetDigest)
          ? { targetDigest: item.targetDigest }
          : (() => { throw new TypeError('IndexNow origin targetDigest is invalid'); })()),
    };
  }).sort((a, b) => codeUnitCompare(a.origin, b.origin));
}

/** @param {unknown} value @param {string | undefined} origin */
function parseFingerprints(value, origin) {
  if (!Array.isArray(value)) throw new TypeError('IndexNow fingerprints must be an array');
  return normalizeFingerprints(value.map((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || !isSha256(item.fingerprint)) {
      throw new TypeError('IndexNow fingerprint entry is invalid');
    }
    assertOnlyKeys(item, ['url', 'fingerprint'], 'IndexNow fingerprint entry');
    return { url: item.url, fingerprint: /** @type {`sha256:${string}`} */ (item.fingerprint) };
  }), origin);
}

/** @param {unknown} value @param {string} origin */
function parseOperations(value, origin) {
  if (!Array.isArray(value)) throw new TypeError('IndexNow operations must be an array');
  const seen = new Set();
  const result = value.map((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || !['upsert', 'remove'].includes(String(item.operation))) {
      throw new TypeError('IndexNow operation is invalid');
    }
    assertOnlyKeys(item, ['url', 'operation', 'fingerprint'], 'IndexNow operation');
    const url = validateCanonicalUrl(item.url, origin);
    if (seen.has(url)) throw new TypeError(`Duplicate IndexNow queue URL ${url}`);
    seen.add(url);
    if (item.operation === 'upsert') {
      if (!isSha256(item.fingerprint)) throw new TypeError('IndexNow upsert fingerprint is invalid');
      return { url, operation: /** @type {const} */ ('upsert'), fingerprint: /** @type {`sha256:${string}`} */ (item.fingerprint) };
    }
    if (item.fingerprint !== undefined) throw new TypeError('IndexNow remove operation must not include a fingerprint');
    return { url, operation: /** @type {const} */ ('remove') };
  });
  result.sort(compareOperations);
  return result;
}

/** @param {unknown} value @param {string} name @param {string} origin */
function parseStateSet(value, name, origin) {
  if (!isRecord(value) || !isSha256(value.digest)) throw new TypeError(`IndexNow state ${name} is invalid`);
  assertOnlyKeys(value, ['digest', 'urls'], `IndexNow state ${name}`);
  const urls = parseFingerprints(value.urls, origin);
  if (value.digest !== sha256(canonicalJson(urls))) throw new TypeError(`IndexNow state ${name} digest does not match`);
  return urls;
}

/** @param {UrlFingerprint[]} values @param {string | undefined} origin */
function normalizeFingerprints(values, origin) {
  const seen = new Set();
  const result = values.map((item) => {
    const url = validateCanonicalUrl(item.url, origin);
    if (!isSha256(item.fingerprint)) throw new TypeError(`Invalid IndexNow fingerprint for ${url}`);
    if (seen.has(url)) throw new TypeError(`Duplicate IndexNow URL ${url}`);
    seen.add(url);
    return { url, fingerprint: item.fingerprint };
  });
  result.sort(compareFingerprints);
  return result;
}

/** @param {UrlFingerprint[]} values */
function groupFingerprintsByOrigin(values) {
  /** @type {Map<string, UrlFingerprint[]>} */
  const output = new Map();
  for (const item of values) {
    const origin = normalizeOrigin(new URL(item.url).origin);
    const bucket = output.get(origin) ?? [];
    bucket.push(item);
    output.set(origin, bucket);
  }
  return output;
}

/** @param {UrlFingerprint} a @param {UrlFingerprint} b */
function compareFingerprints(a, b) {
  return codeUnitCompare(a.url, b.url) || codeUnitCompare(a.fingerprint, b.fingerprint);
}

/** @param {IndexNowOperation} a @param {IndexNowOperation} b */
function compareOperations(a, b) {
  return codeUnitCompare(a.url, b.url) || codeUnitCompare(a.operation, b.operation);
}

/** @param {unknown} value @param {readonly string[]} allowed @param {string} name */
function enumValue(value, allowed, name) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new TypeError(`Invalid IndexNow ${name}`);
  return /** @type {any} */ (value);
}

/** @param {string} value */
export function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('IndexNow origin must be an absolute URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new TypeError('IndexNow origin must be a credential-free HTTPS origin on port 443');
  }
  return url.origin;
}

/** @param {string} value @param {string | undefined} origin */
function validateCanonicalUrl(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('IndexNow URL must be absolute'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('IndexNow URL is unsafe');
  normalizeOrigin(url.origin);
  if (origin && url.origin !== origin) throw new TypeError('IndexNow URL must match its configured origin');
  return url.href;
}

/** @param {string} value @param {string} origin */
function validateSameOriginUrl(value, origin) {
  const url = validateCanonicalUrl(value, origin);
  const parsed = new URL(url);
  if (parsed.search || parsed.hash) throw new TypeError('IndexNow state URL cannot contain a query or fragment');
  if (!parsed.pathname.endsWith(`/.well-known/${INDEXNOW_PUBLIC_FILENAME}`)) {
    throw new TypeError('IndexNow state URL must use the Astro-AEO public state pathname');
  }
  return url;
}

/** @param {string} value */
function normalizePrepareBase(value) {
  if (!value || value === '/') return '';
  const path = validateRootPath(value.replace(/\/$/u, ''), 'base');
  if (path === '/') return '';
  return path;
}

/** @param {string} value @param {string} name */
export function validateRootPath(value, name = 'path') {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /%(?:2e|2f|5c)/iu.test(value)
  ) throw new TypeError(`IndexNow ${name} must be a safe root-relative path`);
  let url;
  try { url = new URL(value, 'https://example.invalid'); } catch { throw new TypeError(`IndexNow ${name} is invalid`); }
  if (url.search || url.hash || url.pathname !== value || url.pathname.split('/').some((part) => part === '.' || part === '..')) {
    throw new TypeError(`IndexNow ${name} cannot contain traversal, a query, or a fragment`);
  }
  return value;
}

/** @param {unknown} value @returns {value is `sha256:${string}`} */
function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} allowed @param {string} label */
function assertOnlyKeys(value, allowed, label) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) throw new TypeError(`${label} contains an unknown field`);
}

/** @param {unknown} value */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {unknown} value @returns {unknown} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  /** @type {Record<string, unknown>} */
  const output = Object.create(null);
  for (const key of Object.keys(value).sort(codeUnitCompare)) output[key] = sortValue(value[key]);
  return output;
}

/** @param {string | Uint8Array} value @returns {`sha256:${string}`} */
export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** @param {string} value */
function normalizeLf(value) {
  return value.replace(/\r\n?/gu, '\n');
}

/** @param {string} a @param {string} b */
function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
