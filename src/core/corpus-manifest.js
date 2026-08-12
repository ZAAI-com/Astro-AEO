// @ts-check
import { normalizePublishedText } from './corpus-tokenizer.js';

const encoder = new TextEncoder();

/** Compare strings by UTF-16 code units without locale-sensitive behavior. */
export function compareCodeUnits(/** @type {string} */ left, /** @type {string} */ right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Produce compact canonical JSON with sorted object keys and semantically
 * ordered arrays left untouched.
 * @param {unknown} value
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, '$', new Set()));
}

/**
 * Hash exact bytes with portable Web Crypto.
 * @param {string | Uint8Array} value
 */
export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable in this runtime.');
  const digestInput = Uint8Array.from(bytes);
  const digest = new Uint8Array(await subtle.digest('SHA-256', digestInput.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {string | Uint8Array} value */
export async function sha256Digest(value) {
  return `sha256:${await sha256Hex(value)}`;
}

/**
 * Normalize and sort the versioned public manifest. Input records are cloned;
 * caller-owned arrays and page chunk lists are never mutated.
 * @param {any} manifest
 */
export function normalizeCorpusManifest(manifest) {
  const locales = manifest.locales.map((/** @type {any} */ entry) => ({
    origin: entry.origin,
    locale: entry.locale ?? null,
    language: entry.language ?? null,
    canonicalArtifact: entry.canonicalArtifact,
  })).sort(compareLocaleRecords);

  const pages = manifest.pages.map((/** @type {any} */ entry) => ({
    origin: entry.origin,
    id: entry.id,
    canonicalUrl: entry.canonicalUrl,
    markdownUrl: entry.markdownUrl,
    locale: entry.locale ?? null,
    language: entry.language ?? null,
    section: entry.section,
    tokenCount: entry.tokenCount,
    hash: entry.hash,
    sourceStrategy: entry.sourceStrategy,
    ...(entry.modified === undefined ? {} : { modified: entry.modified }),
    chunks: [...entry.chunks].sort(compareCodeUnits),
  })).sort(comparePageRecords);

  const artifacts = manifest.artifacts.map((/** @type {any} */ entry) => ({
    origin: entry.origin,
    pathname: entry.pathname,
    kind: entry.kind,
    locale: entry.locale ?? null,
    section: entry.section ?? null,
    part: entry.part ?? null,
    tokenCount: entry.tokenCount,
    hash: entry.hash,
    encoding: entry.encoding,
    sourcePathname: entry.sourcePathname ?? null,
  })).sort(compareArtifactRecords);

  return {
    version: /** @type {1} */ (1),
    origin: manifest.origin,
    base: manifest.base,
    tokenizer: {
      name: manifest.tokenizer.name,
      version: manifest.tokenizer.version,
      approximate: manifest.tokenizer.approximate,
    },
    locales,
    pages,
    artifacts,
  };
}

/** @param {any} manifest */
export function serializeCorpusManifest(manifest) {
  return `${JSON.stringify(normalizeCorpusManifest(manifest), null, 2)}\n`;
}

/**
 * Build a public manifest from records that still carry their source bytes.
 * `markdown` and `contents` are consumed for hashes and never returned.
 *
 * @param {{
 *   origin: string;
 *   base: string;
 *   tokenizer: { name: string; version: string; approximate: boolean };
 *   locales: any[];
 *   pages: Array<any & { markdown: string }>;
 *   artifacts: Array<any & { contents: string | Uint8Array }>;
 * }} input
 */
export async function createCorpusManifest(input) {
  const pages = await Promise.all(input.pages.map(async ({ markdown, ...entry }) => ({
    ...entry,
    hash: await sha256Digest(normalizePublishedText(markdown)),
  })));
  const artifacts = await Promise.all(input.artifacts.map(async ({ contents, ...entry }) => ({
    ...entry,
    hash: await sha256Digest(contents),
  })));
  return normalizeCorpusManifest({
    version: 1,
    origin: input.origin,
    base: input.base,
    tokenizer: input.tokenizer,
    locales: input.locales,
    pages,
    artifacts,
  });
}

/** @param {any} left @param {any} right */
function compareLocaleRecords(left, right) {
  return compareTuple(
    [left.origin, left.locale ?? '', left.language ?? '', left.canonicalArtifact],
    [right.origin, right.locale ?? '', right.language ?? '', right.canonicalArtifact],
  );
}

/** @param {any} left @param {any} right */
function comparePageRecords(left, right) {
  return compareTuple(
    [left.origin, left.id, left.canonicalUrl, left.locale ?? '', left.section],
    [right.origin, right.id, right.canonicalUrl, right.locale ?? '', right.section],
  );
}

/** @param {any} left @param {any} right */
function compareArtifactRecords(left, right) {
  return compareTuple(
    [left.origin, left.pathname, left.encoding, left.kind, left.locale ?? '', left.section ?? '', String(left.part ?? '')],
    [right.origin, right.pathname, right.encoding, right.kind, right.locale ?? '', right.section ?? '', String(right.part ?? '')],
  );
}

/** @param {string[]} left @param {string[]} right */
function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const comparison = compareCodeUnits(left[index] ?? '', right[index] ?? '');
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/** @param {unknown} value @param {string} path */
/** @param {unknown} value @param {string} path @param {Set<object>} seen @returns {any} */
function canonicalValue(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} contains a non-finite number.`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
    seen.add(value);
    try {
      return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${path} is not a JSON value.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} is not a plain JSON object.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  try {
    const output = Object.create(null);
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new TypeError(`${path}.${key} is an accessor.`);
      output[key] = canonicalValue(descriptor.value, `${path}.${key}`, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}
