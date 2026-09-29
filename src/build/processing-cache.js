// @ts-check
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { acquirePrivateLock } from './private-lock.js';
import { readPackageVersion } from './package-version.js';

export const PROCESSING_CACHE_VERSION = 1;
export const PROCESSING_CACHE_DIRECTORY = 'processing-v1';
export const PROCESSING_CACHE_PRODUCER = 'astro-aeo';

/**
 * @typedef {{ blob: string }} CacheEntry
 * @typedef {{ name: string; version: string }} CacheProducer
 * @typedef {{ version: 1; producer?: CacheProducer; entries: Record<string, CacheEntry> }} CacheState
 */

/**
 * Open the versioned processing cache and acquire its safety lock. A corrupt
 * state or unverifiable lock intentionally produces a cold read-only session.
 * State written by another astro-aeo version starts from empty entries instead,
 * so an upgrade never serves the previous version's Markdown.
 *
 * @param {string} projectRoot
 * @param {{ enabled: boolean; packageVersion?: string; diagnostics?: import('../index.js').Diagnostic[]; logger?: { info?: (message: string) => void; warn: (message: string) => void } }} options
 */
export function openProcessingCache(projectRoot, options) {
  const diagnostics = options.diagnostics ?? [];
  const packageVersion = options.packageVersion ?? readPackageVersion();
  const root = join(projectRoot, '.astro', 'aeo-cache', PROCESSING_CACHE_DIRECTORY);
  const blobsRoot = join(root, 'blobs');
  const statePath = join(root, 'state.json');
  const lockPath = join(root, 'lock');
  let lockOwned = false;
  /** @type {(() => void) | undefined} */
  let releaseLock;
  let readOnly = false;
  /** @type {CacheState} */
  let state = { version: 1, entries: {} };
  /** @type {Map<string, Buffer>} */
  const pendingBlobs = new Map();
  /** @type {Set<string>} */
  const touchedKeys = new Set();
  const stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    invalidations: /** @type {Record<string, number>} */ ({}),
  };

  /** @param {string} reason */
  function miss(reason) {
    stats.misses++;
    stats.invalidations[reason] = (stats.invalidations[reason] ?? 0) + 1;
  }

  /** @param {string} code @param {string} message */
  function report(code, message) {
    diagnostics.push({ version: 1, code, severity: 'warning', message });
    options.logger?.warn(`astro-aeo: ${message}`);
  }

  const api = {
    root,
    statePath,
    blobsRoot,
    get enabled() {
      return options.enabled;
    },
    get readOnly() {
      return readOnly;
    },
    stats,

    /**
     * @param {string} stage
     * @param {unknown} inputs
     */
    key(stage, inputs) {
      return `${stage}:${sha256(canonicalStringify({ stage, producer: packageVersion, inputs }))}`;
    },

    /**
     * @param {string} key
     * @returns {unknown | undefined}
     */
    get(key) {
      if (!options.enabled || readOnly) {
        miss(!options.enabled ? 'disabled' : 'read-only');
        return undefined;
      }
      const entry = state.entries[key];
      if (!entry) {
        miss('key-missing');
        return undefined;
      }
      try {
        const path = join(blobsRoot, entry.blob);
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('unsafe blob');
        const bytes = readFileSync(path);
        if (sha256(bytes) !== entry.blob) throw new TypeError('corrupt blob');
        stats.hits++;
        touchedKeys.add(key);
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        miss('blob-invalid');
        return undefined;
      }
    },

    /** @param {string} key @param {unknown} value */
    put(key, value) {
      if (!options.enabled || readOnly) return;
      const bytes = Buffer.from(canonicalStringify(value), 'utf8');
      const blob = sha256(bytes);
      pendingBlobs.set(blob, bytes);
      state.entries[key] = { blob };
      touchedKeys.add(key);
      stats.writes++;
    },

    /**
     * Register pending blobs, the state index, and safe stale blob cleanup in
     * the build's existing atomic writer. Only entries touched by this session
     * are written, so blobs of pages that no longer convert are swept as
     * orphans and the cache cannot grow without bound.
     * @param {{ stagePrivateWrite?: Function; stagePrivateDelete?: Function }} writer
     */
    stage(writer) {
      if (!options.enabled || readOnly || !writer.stagePrivateWrite) return;
      const entries = Object.fromEntries(
        [...touchedKeys].filter((key) => state.entries[key]).map((key) => [key, state.entries[key]]),
      );
      const retained = new Set(Object.values(entries).map((entry) => entry.blob));
      for (const [blob, bytes] of pendingBlobs) {
        const path = join(blobsRoot, blob);
        if (regularFileHash(path) === blob) continue;
        writer.stagePrivateWrite(path, bytes, { mode: 0o600, confineTo: root });
      }
      writer.stagePrivateWrite(
        statePath,
        `${JSON.stringify(
          { version: 1, producer: { name: PROCESSING_CACHE_PRODUCER, version: packageVersion }, entries },
          null,
          2,
        )}\n`,
        { mode: 0o600, confineTo: root },
      );
      if (writer.stagePrivateDelete) {
        for (const stale of staleBlobPaths(blobsRoot, retained)) {
          writer.stagePrivateDelete(stale, { confineTo: root });
        }
      }
    },

    close() {
      if (!lockOwned || releaseLock === undefined) return;
      lockOwned = false;
      releaseLock();
    },
  };

  if (!options.enabled) {
    readOnly = true;
    return api;
  }

  try {
    mkdirSync(blobsRoot, { recursive: true, mode: 0o700 });
    acquireLock();
  } catch {
    readOnly = true;
    report('processing-cache-lock-unavailable', 'The processing cache is locked or unavailable; this build is cold and cache state is read-only.');
  }

  if (!readOnly && fileExists(statePath)) {
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
      if (!validState(parsed)) throw new TypeError('invalid state');
      state = parsed;
      if (
        state.producer?.name !== PROCESSING_CACHE_PRODUCER ||
        state.producer?.version !== packageVersion
      ) {
        resetAfterUpgrade(state.producer?.version, Object.keys(state.entries).length);
      }
    } catch {
      readOnly = true;
      report('processing-cache-invalid', 'The processing cache state is invalid; this build is cold and grants no reusable-state authority.');
    }
  }

  /**
   * Drop another version's entries but keep writing: an upgrade must not serve
   * the previous version's extraction output, and it is not corruption.
   *
   * @param {string | undefined} previousVersion
   * @param {number} previousEntries
   */
  function resetAfterUpgrade(previousVersion, previousEntries) {
    stats.invalidations['package-version'] = previousEntries;
    state = { version: 1, entries: {} };
    options.logger?.info?.(
      previousVersion
        ? `astro-aeo: processing cache reset after upgrade (${previousVersion} -> ${packageVersion})`
        : 'astro-aeo: processing cache reset after upgrade',
    );
  }

  /** Acquire or safely reclaim a same-host dead-process lock. */
  function acquireLock() {
    releaseLock = acquirePrivateLock(lockPath, {
      busy: 'processing cache is locked',
      unsafe: 'processing cache lock is unsafe',
      changed: 'processing cache lock changed during inspection',
    });
    lockOwned = true;
  }

  return api;
}

/** @param {unknown} value */
export function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

/** @param {unknown} value @returns {unknown} */
function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[function]';
  if (value instanceof URL) return value.href;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return String(value);
}

/** @param {string | Buffer} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
function validProducer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {any} */ (value);
  return typeof candidate.name === 'string' && typeof candidate.version === 'string';
}

/** @param {unknown} value @returns {value is CacheState} */
function validState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {any} */ (value);
  if (candidate.version !== 1 || !candidate.entries || typeof candidate.entries !== 'object' || Array.isArray(candidate.entries)) return false;
  // A missing producer is a legacy state, which simply resets on open. A
  // present but malformed one means the file cannot be interpreted safely.
  if (candidate.producer !== undefined && !validProducer(candidate.producer)) return false;
  return Object.entries(candidate.entries).every(([key, entry]) =>
    typeof key === 'string' && key.includes(':') &&
    entry && typeof entry === 'object' &&
    typeof /** @type {any} */ (entry).blob === 'string' && /^[a-f\d]{64}$/.test(/** @type {any} */ (entry).blob),
  );
}

/** @param {string} path */
function fileExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path */
function regularFileHash(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

/** @param {string} root @param {Set<string>} retained */
function staleBlobPaths(root, retained) {
  /** @type {string[]} */
  const paths = [];
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return paths;
  }
  for (const name of names) {
    if (!/^[a-f\d]{64}$/.test(name) || retained.has(name)) continue;
    const path = join(root, name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink()) paths.push(path);
    } catch {
      // Ignore entries that changed during inspection.
    }
  }
  return paths;
}
