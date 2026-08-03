// @ts-check
import { writeFileSync, mkdirSync, existsSync, copyFileSync, constants } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from '../core/match.js';

/**
 * One place that writes build output.
 *
 * Before this, each generator called `writeFileSync` itself under one of three
 * different collision policies (silent overwrite, warn then overwrite, warn and
 * skip), and none of them could see what the others or the project had already
 * claimed. The policies are preserved exactly, because they are the documented
 * behaviour; what is new is that a collision is detected and named rather than
 * discovered by a user wondering where their endpoint output went.
 */

/**
 * @typedef {'dotmd'|'llmsTxt'|'llmsFullTxt'|'robotsTxt'|'domainProfile'|'urlMap'|'sitemapAlias'} ArtifactOwner
 */

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
  // Normalize on the way in so a caller passing raw Astro route strings (which may
  // carry a trailing slash) matches the same way a normalized set does.
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

    // 1. astro-aeo colliding with itself. Always wrong, and previously invisible:
    //    two generators pointed at one path just raced, last writer winning.
    const priorOwner = claimed.get(path);
    if (priorOwner && priorOwner !== owner) {
      logger.warn(
        `astro-aeo: ${owner} and ${priorOwner} both write ${displayPath(root, path)}. ` +
          'Change one of their output paths; the later write wins and the earlier output is lost.',
      );
    }

    // 2. A route the project defines itself. The generator would silently clobber
    //    the endpoint's own output, which is the project's, not ours.
    if (route && routes?.has(normalizePath(route))) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} is also produced by a route in this project. ` +
          `Astro-AEO overwrote it; remove the route, or turn off the ${owner} output.`,
      );
    }

    // 3. A file the project committed to public/. Distinguishable from another
    //    integration's output, so it gets its own wording.
    if (route && publicDir && existsSync(join(fileURLToPath(publicDir), route.replace(/^\/+/, '')))) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} also exists in public/. ` +
          `Astro-AEO overwrote the copied file; remove it, or turn off the ${owner} output.`,
      );
    }

    // 4. Anything already at the destination, under the owner's declared policy.
    if (existsSync(path)) {
      if (onConflict === 'skip') {
        if (conflictMessage) logger.warn(conflictMessage);
        return false;
      }
      if (onConflict === 'warn-overwrite' && conflictMessage) logger.warn(conflictMessage);
    }

    mkdirSync(dirname(path), { recursive: true });
    if (artifact.copyFrom) {
      // COPYFILE_EXCL rather than a read-then-write, so the copy stays exact and
      // the existence check above cannot race with another writer.
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
 * @param {unknown} err
 * @returns {boolean}
 */
function isAlreadyExistsError(err) {
  return Boolean(err) && /** @type {any} */ (err).code === 'EEXIST';
}
