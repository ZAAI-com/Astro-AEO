// @ts-check
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const OWNERSHIP_MANIFEST_VERSION = 1;
export const OWNERSHIP_MANIFEST_FILENAME = 'ownership-v1.json';

/** @param {string} projectRoot @returns {string} */
export function ownershipManifestPath(projectRoot) {
  return join(projectRoot, '.astro', 'aeo-cache', OWNERSHIP_MANIFEST_FILENAME);
}

/**
 * The manifest must not disclose an absolute build path. A stable digest is
 * enough to keep ownership from one outDir from authorizing writes in another.
 * @param {string} outputRoot
 */
export function outputRootId(outputRoot) {
  return `sha256:${createHash('sha256').update(outputRoot).digest('hex')}`;
}

/** @param {string | Buffer} value */
export function representationMetadata(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return {
    byteLength: bytes.byteLength,
    etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
  };
}

/** @param {string} path @returns {string | null} */
export function fileEtag(path) {
  try {
    return representationMetadata(readFileSync(path)).etag;
  } catch {
    return null;
  }
}

/**
 * Load only the narrow, versioned shape needed for stale-output arbitration.
 * A malformed or future manifest never grants overwrite/delete authority.
 * @param {string | undefined} projectRoot
 * @returns {any | null}
 */
export function readOwnershipManifest(projectRoot) {
  if (!projectRoot) return null;
  try {
    const parsed = JSON.parse(readFileSync(ownershipManifestPath(projectRoot), 'utf8'));
    if (!isOwnershipManifest(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decode the complete authority-bearing shape. A single malformed nested
 * entry makes the prior ledger unusable so untrusted JSON can never grant
 * overwrite or deletion rights.
 * @param {unknown} value
 */
function isOwnershipManifest(value) {
  if (!isRecord(value)) return false;
  if (value.version !== OWNERSHIP_MANIFEST_VERSION) return false;
  if (typeof value.outputRootId !== 'string' || !/^sha256:[a-f\d]{64}$/.test(value.outputRootId)) return false;
  if (typeof value.base !== 'string' || !value.base.startsWith('/')) return false;
  if (!Array.isArray(value.artifacts) || !value.artifacts.every(isOwnershipArtifact)) return false;
  if (!Array.isArray(value.groups) || !value.groups.every(isOwnershipGroup)) return false;
  return value.generatedAt === undefined || (
    typeof value.generatedAt === 'string' && !Number.isNaN(Date.parse(value.generatedAt))
  );
}

/** @param {unknown} value */
function isOwnershipArtifact(value) {
  if (!isRecord(value) || typeof value.pathname !== 'string') return false;
  if (!safeManifestPathname(value.pathname)) return false;
  if (!['emitted', 'runtime', 'preserved', 'conflict', 'group-skipped'].includes(value.status)) return false;
  if (value.group !== undefined && (typeof value.group !== 'string' || !value.group)) return false;
  if (value.status === 'conflict') {
    return Array.isArray(value.claimants) && value.claimants.every((entry) =>
      isRecord(entry) && isGeneratedOwner(entry.owner) && Number.isSafeInteger(entry.count) && entry.count > 0,
    );
  }
  if (!isGeneratedOwner(value.owner)) return false;
  if (value.status === 'emitted') {
    return (
      safeRecordedPath(value.outputPath) &&
      isRecord(value.representation) &&
      typeof value.representation.contentType === 'string' &&
      Number.isSafeInteger(value.representation.byteLength) &&
      value.representation.byteLength >= 0 &&
      typeof value.representation.etag === 'string' &&
      /^"[a-f\d]{64}"$/.test(value.representation.etag)
    );
  }
  if (value.status === 'preserved') {
    return Array.isArray(value.blockingOwners) && value.blockingOwners.every(isBlockingOwner);
  }
  if (value.status === 'group-skipped') {
    return typeof value.group === 'string' && Array.isArray(value.causedBy) && value.causedBy.every(safeManifestPathname);
  }
  return true;
}

/** @param {unknown} value */
function isOwnershipGroup(value) {
  return Boolean(
    isRecord(value) &&
    typeof value.id === 'string' && value.id &&
    value.mode === 'all-or-none' &&
    (value.status === 'emitted' || value.status === 'skipped') &&
    Array.isArray(value.pathnames) && value.pathnames.every(safeManifestPathname)
  );
}

/** @param {unknown} value */
function isGeneratedOwner(value) {
  return Boolean(
    isRecord(value) &&
    (value.kind === 'core' || value.kind === 'plugin') &&
    typeof value.name === 'string' && value.name &&
    (value.claimId === undefined || typeof value.claimId === 'string')
  );
}

/** @param {unknown} value */
function isBlockingOwner(value) {
  return Boolean(
    isRecord(value) &&
    ['project-route', 'public-file', 'existing-output'].includes(value.kind) &&
    (value.rendering === undefined || value.rendering === 'prerendered' || value.rendering === 'on-demand')
  );
}

/** @param {unknown} value */
function safeManifestPathname(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !decoded.split('/').some((part) => part === '.' || part === '..' || part.includes('\0'));
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function safeRecordedPath(value) {
  return typeof value === 'string' && Boolean(value) && !value.startsWith('/') && !value.includes('\\') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} manifest @returns {string} */
export function serializeOwnershipManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Return a manifest-safe POSIX path relative to outDir, or null if the target
 * escapes it. Never trust a previous manifest path for filesystem resolution.
 * @param {string} outputRoot
 * @param {string} path
 */
export function relativeOutputPath(outputRoot, path) {
  const value = relative(outputRoot, path);
  if (!value || value === '..' || value.startsWith(`..${sep}`)) return null;
  return value.split(sep).join('/');
}

/**
 * Resolve a previously recorded relative output path only after confinement
 * checks. This intentionally supports files, not the output root itself.
 * @param {string} outputRoot
 * @param {unknown} value
 */
export function resolveRecordedOutputPath(outputRoot, value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  const path = join(outputRoot, ...value.split('/'));
  if (relativeOutputPath(outputRoot, path) !== value) return null;

  // A lexical child can still escape through an existing symlinked directory.
  // The final component itself may be a symlink because rename/delete acts on
  // that directory entry, but no ancestor may redirect traversal elsewhere.
  let ancestor = outputRoot;
  for (const part of value.split('/').slice(0, -1)) {
    ancestor = join(ancestor, part);
    try {
      const stat = lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'ENOENT') return null;
      // A missing ancestor is safe only for this inspection. Transaction callers
      // must revalidate immediately before staging and applying filesystem work.
      break;
    }
  }
  return path;
}

/**
 * Recheck that a concrete destination is still lexically confined and has no
 * symlinked ancestor below its trusted output root.
 * @param {string} outputRoot
 * @param {string} path
 */
export function isSafeOutputPath(outputRoot, path) {
  const outputPath = relativeOutputPath(outputRoot, path);
  return outputPath !== null && resolveRecordedOutputPath(outputRoot, outputPath) !== null;
}
