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
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== OWNERSHIP_MANIFEST_VERSION ||
      typeof parsed.outputRootId !== 'string' ||
      !Array.isArray(parsed.artifacts) ||
      !Array.isArray(parsed.groups)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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
