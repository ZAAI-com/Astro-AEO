// @ts-check
import { writeFileSync, mkdirSync, existsSync, copyFileSync, constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from '../core/match.js';

/**
 * @typedef {'dotmd'|'llmsTxt'|'llmsFullTxt'|'robotsTxt'|'domainProfile'|'urlMap'|'sitemapAlias'} ArtifactOwner
 */

/** @type {ArtifactOwner[]} */
const OWNER_ORDER = [
  'dotmd',
  'llmsTxt',
  'llmsFullTxt',
  'robotsTxt',
  'domainProfile',
  'urlMap',
  'sitemapAlias',
];

/**
 * @typedef {object} Artifact
 * @property {string} path                Absolute output path.
 * @property {ArtifactOwner} owner
 * @property {string} [route]             Root-relative URL, for the route and public checks.
 * @property {string} [contents]          Mutually exclusive with `copyFrom`.
 * @property {string} [copyFrom]          Byte-copy source; keeps the copy at the filesystem level.
 * @property {'overwrite'|'warn-overwrite'|'skip'} onConflict
 * @property {string} [conflictMessage]   Emitted verbatim for 'warn-overwrite' and 'skip'.
 */

/**
 * @param {object} deps
 * @param {URL} deps.distDir
 * @param {{ info: (m: string) => void; warn: (m: string) => void }} deps.logger
 * @param {Set<string>} [deps.routePaths]   Concrete route pathnames from astro:routes:resolved.
 * @param {URL} [deps.publicDir]            Astro's publicDir, for committed-file detection.
 */
export function createArtifactWriter({ distDir, logger, routePaths, publicDir }) {
  const root = fileURLToPath(distDir);
  const routes = routePaths ? new Set([...routePaths].map(normalizePath)) : undefined;
  /** @type {Map<string, ArtifactOwner>} */
  const claimed = new Map();
  /** @type {Map<ArtifactOwner, number>} */
  const counts = new Map();

  /**
   * @param {Artifact} artifact
   * @returns {boolean} whether bytes were written
   */
  function write(artifact) {
    const { path, owner, route, onConflict, conflictMessage } = artifact;

    const priorOwner = claimed.get(path);
    const projectRouteCollision = Boolean(route && routes?.has(normalizePath(route)));
    const publicRoot = publicDir ? fileURLToPath(publicDir) : undefined;
    const publicFile = publicRoot
      ? route
        ? join(publicRoot, route.replace(/^\/+/, ''))
        : pathWithin(publicRoot, path)
          ? path
          : undefined
      : undefined;
    const publicCollision = Boolean(publicFile && existsSync(publicFile));
    const destinationExists = existsSync(path);

    const skipCollision =
      onConflict === 'skip' &&
      Boolean(destinationExists || priorOwner || projectRouteCollision || publicCollision);

    if (skipCollision) {
      if (destinationExists && conflictMessage) logger.warn(conflictMessage);
      if (priorOwner && priorOwner !== owner) {
        logger.warn(
          `astro-aeo: ${owner} and ${priorOwner} both claim ${displayPath(root, path)}. ` +
            `The existing ${priorOwner} output was retained by the skip policy.`,
        );
      }
      if (projectRouteCollision) {
        logger.warn(
          `astro-aeo: ${displayPath(root, path)} is also produced by a route in this project. ` +
            `The project route output was retained; turn off the ${owner} output to remove this collision.`,
        );
      }
      if (publicCollision) {
        logger.warn(
          `astro-aeo: ${displayPath(root, path)} also exists in public/. ` +
            `The copied public file was retained; turn off the ${owner} output to remove this collision.`,
        );
      }
      return false;
    }

    if (priorOwner && priorOwner !== owner) {
      logger.warn(
        `astro-aeo: ${owner} and ${priorOwner} both write ${displayPath(root, path)}. ` +
          'Change one of their output paths; the later write wins and the earlier output is lost.',
      );
    }

    if (projectRouteCollision) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} is also produced by a route in this project. ` +
          `Astro-AEO overwrote it; remove the route, or turn off the ${owner} output.`,
      );
    }

    if (publicCollision) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} also exists in public/. ` +
          `Astro-AEO overwrote the copied file; remove it, or turn off the ${owner} output.`,
      );
    }

    if (destinationExists) {
      if (onConflict === 'warn-overwrite' && conflictMessage) logger.warn(conflictMessage);
    }

    mkdirSync(dirname(path), { recursive: true });
    if (artifact.copyFrom) {
      try {
        copyFileSync(artifact.copyFrom, path, constants.COPYFILE_EXCL);
      } catch (err) {
        if (isAlreadyExistsError(err) && onConflict === 'skip') {
          if (conflictMessage) logger.warn(conflictMessage);
          return false;
        }
        throw err;
      }
    } else {
      writeFileSync(path, artifact.contents ?? '', 'utf8');
    }

    claimed.set(path, owner);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    return true;
  }

  return {
    write,
    /**
     * @param {Artifact[]} artifacts
     * @returns {{ written: number; skipped: Artifact[] }}
     */
    writeAll(artifacts) {
      let written = 0;
      /** @type {Artifact[]} */
      const skipped = [];
      for (const artifact of artifacts) {
        if (write(artifact)) written++;
        else skipped.push(artifact);
      }
      return { written, skipped };
    },
    /** @param {ArtifactOwner} owner */
    count(owner) {
      return counts.get(owner) ?? 0;
    },
    /** @returns {{ total: number; byOwner: Partial<Record<ArtifactOwner, number>> }} */
    report() {
      /** @type {Partial<Record<ArtifactOwner, number>>} */
      const byOwner = {};
      let total = 0;
      for (const owner of OWNER_ORDER) {
        const count = counts.get(owner) ?? 0;
        if (!count) continue;
        byOwner[owner] = count;
        total += count;
      }

      const details = OWNER_ORDER.flatMap((owner) =>
        byOwner[owner] ? [`${owner}=${byOwner[owner]}`] : [],
      ).join(', ');
      logger.info(
        `astro-aeo: artifact registry wrote ${total} artifact(s)` +
          (details ? `: ${details}` : ''),
      );
      return { total, byOwner };
    },
  };
}

/**
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
function displayPath(root, path) {
  const rel = relative(root, path);
  return rel && !rel.startsWith(`..${sep}`) ? `/${rel.split(sep).join('/')}` : path;
}

/**
 * @param {string} root
 * @param {string} path
 */
function pathWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAlreadyExistsError(err) {
  return Boolean(err) && /** @type {any} */ (err).code === 'EEXIST';
}
