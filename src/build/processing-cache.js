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
import { extractionProducer } from './package-version.js';

export const PROCESSING_CACHE_VERSION = 1;
export const PROCESSING_CACHE_DIRECTORY = 'processing-v1';

/**
 * @typedef {{ blob: string }} CacheEntry
 * @typedef {import('./package-version.js').ExtractionProducer} CacheProducer
 * @typedef {{ version: 1; producer?: unknown; entries: Record<string, CacheEntry> }} CacheState
 * @typedef {{ from: CacheProducer | undefined; to: CacheProducer; dropped: number }} CacheReset
 */

/**
 * Open the versioned processing cache and acquire its safety lock. A corrupt
 * state or unverifiable lock intentionally produces a cold read-only session.
 *
 * The producer (astro-aeo plus the turndown and linkedom versions) is part of
 * every key, so no other version's results are ever reused, in either
 * direction. `state.json` records it only to explain a reset: when the stored
 * producer is missing, malformed, or different, the session drops the old
 * entries, stays writable, and reports the reset in `stats.reset`.
 *
 * @param {string} projectRoot
 * @param {{ enabled: boolean; producer?: CacheProducer; diagnostics?: import('../index.js').Diagnostic[]; logger?: { warn: (message: string) => void } }} options
 */
export function openProcessingCache(projectRoot, options) {
  const diagnostics = options.diagnostics ?? [];
  const producer = options.producer ?? extractionProducer();
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
    /** @type {CacheReset | undefined} */
    reset: undefined,
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
      return `${stage}:${sha256(canonicalStringify({ stage, producer, inputs }))}`;
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
     * the build's existing atomic writer. With `sweep` (the default) only
     * entries this session hit or wrote are kept, so blobs of pages that no
     * longer convert become orphans and the cache cannot grow without bound.
     * Pass `sweep: false` after an incomplete inventory to keep the untouched
     * entries of pages this build could not see.
     * @param {{ stagePrivateWrite?: Function; stagePrivateDelete?: Function }} writer
     * @param {{ sweep?: boolean }} [stageOptions]
     */
    stage(writer, { sweep = true } = {}) {
      if (!options.enabled || readOnly || !writer.stagePrivateWrite) return;
      const entries = sweep
        ? Object.fromEntries(
            [...touchedKeys].filter((key) => state.entries[key]).map((key) => [key, state.entries[key]]),
          )
        : state.entries;
      const retained = new Set(Object.values(entries).map((entry) => entry.blob));
      for (const [blob, bytes] of pendingBlobs) {
        const path = join(blobsRoot, blob);
        if (regularFileHash(path) === blob) continue;
        writer.stagePrivateWrite(path, bytes, { mode: 0o600, confineTo: root });
      }
      writer.stagePrivateWrite(
        statePath,
        `${JSON.stringify(
          { version: 1, producer, entries },
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
    } catch {
      readOnly = true;
      report('processing-cache-invalid', 'The processing cache state is invalid; this build is cold and grants no reusable-state authority.');
    }
    if (!readOnly) resetForOtherProducer();
  }

  /**
   * Drop entries written by another producer but keep writing. Their keys can
   * never match this producer's keys, and a producer change is not corruption:
   * going read-only here would withhold IndexNow state on every later build.
   * An empty previous state has nothing to drop and reports nothing.
   */
  function resetForOtherProducer() {
    const dropped = Object.keys(state.entries).length;
    const from = readProducer(state.producer);
    if (dropped === 0 || (from && sameProducer(from, producer))) return;
    stats.invalidations['package-version'] = dropped;
    stats.reset = { from, to: producer, dropped };
    state = { version: 1, entries: {} };
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

/**
 * Read a stored producer, or undefined when it is missing (a state written
 * before 1.5.0) or not a well-formed astro-aeo producer. Unknown dependency
 * versions read as 'unknown' so a partial producer still compares unequal.
 *
 * @param {unknown} value
 * @returns {CacheProducer | undefined}
 */
function readProducer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = /** @type {any} */ (value);
  if (candidate.name !== 'astro-aeo' || typeof candidate.version !== 'string') return undefined;
  const dependencies = candidate.dependencies && typeof candidate.dependencies === 'object'
    ? candidate.dependencies
    : {};
  return {
    name: 'astro-aeo',
    version: candidate.version,
    dependencies: {
      turndown: typeof dependencies.turndown === 'string' ? dependencies.turndown : 'unknown',
      linkedom: typeof dependencies.linkedom === 'string' ? dependencies.linkedom : 'unknown',
    },
  };
}

/** @param {CacheProducer} left @param {CacheProducer} right */
function sameProducer(left, right) {
  return left.version === right.version &&
    left.dependencies.turndown === right.dependencies.turndown &&
    left.dependencies.linkedom === right.dependencies.linkedom;
}

/**
 * Describe a reset in one neutral line that fits upgrades, downgrades,
 * dependency drift, and states written before the producer was recorded.
 *
 * @param {CacheReset} reset
 * @returns {string}
 */
export function describeProcessingCacheReset(reset) {
  const { from, to, dropped } = reset;
  /** @type {string[]} */
  let changes;
  if (!from) {
    changes = [`an earlier astro-aeo -> astro-aeo ${to.version}`];
  } else if (from.version !== to.version) {
    changes = [`astro-aeo ${from.version} -> ${to.version}`];
  } else {
    changes = /** @type {const} */ (['turndown', 'linkedom'])
      .filter((name) => from.dependencies[name] !== to.dependencies[name])
      .map((name) => `${name} ${from.dependencies[name]} -> ${to.dependencies[name]}`);
  }
  return `astro-aeo: processing cache reset after an extractor change (${changes.join(', ')}); ` +
    `${dropped} cached page(s) will be extracted again`;
}

/** @param {unknown} value @returns {value is CacheState} */
function validState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {any} */ (value);
  if (candidate.version !== 1 || !candidate.entries || typeof candidate.entries !== 'object' || Array.isArray(candidate.entries)) return false;
  // `producer` is deliberately not validated: it only explains a reset, and a
  // missing or malformed one resets entries instead of making the cache read-only.
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
