// @ts-check
import { writeFileSync, mkdirSync, lstatSync, copyFileSync, constants, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRootPathname, normalizePath } from '../core/match.js';
import { exactPathnameIdentity } from '../core/artifact-path.js';
import {
  fileEtag,
  outputRootId,
  ownershipManifestPath,
  readOwnershipManifest,
  relativeOutputPath,
  representationMetadata,
  resolveRecordedOutputPath,
  serializeOwnershipManifest,
} from './ownership.js';
import { commitFileTransaction } from './transaction.js';

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

// These findings describe invalid or ambiguous write authority, not optional
// quality advice. They remain build-blocking even when validation.onBuild is
// disabled so a configuration switch cannot authorize an unsafe commit.
const MANDATORY_ARTIFACT_CODES = new Set([
  'artifact-invalid-replacement-path',
  'artifact-invalid-representation',
  'artifact-invalid-pathname',
  'artifact-invalid-destination',
  'artifact-generated-conflict',
  'plugin-build-complete-isolated',
  'indexnow-site-required',
  'indexnow-state-unavailable',
]);

/**
 * @typedef {object} Artifact
 * @property {string} [path]              Absolute legacy/internal output path.
 * @property {ArtifactOwner | { kind: 'core'|'plugin'; name: string; claimId?: string }} owner
 * @property {string} [route]             Root-relative URL, for the route and public checks.
 * @property {string} [pathname]          Canonical served URL for public/plugin claims.
 * @property {string | Uint8Array} [contents] Mutually exclusive with `copyFrom`.
 * @property {string} [copyFrom]          Byte-copy source; keeps the copy at the filesystem level.
 * @property {{ body: string; contentType: string }} [representation]
 * @property {string} [contentType]        Internal binary/text content type override.
 * @property {boolean} [replace]           Plugin-owned exact replacement authorization.
 * @property {boolean} [runtime]           Reserve ownership for middleware without emitting a file.
 * @property {string} [group]              Internal all-or-none group.
 * @property {'overwrite'|'warn-overwrite'|'skip'} [onConflict]
 * @property {string} [conflictMessage]   Emitted verbatim for 'warn-overwrite' and 'skip'.
 */

/** @typedef {{ pattern: RegExp; prerendered: boolean }} RouteMatcher */

/**
 * @param {object} deps
 * @param {URL} deps.distDir
 * @param {{ info: (m: string) => void; warn: (m: string) => void }} deps.logger
 * @param {Set<string>} [deps.routePaths]   Concrete route pathnames from astro:routes:resolved.
 * @param {RouteMatcher[]} [deps.routeMatchers] Dynamic project routes from astro:routes:resolved.
 * @param {URL} [deps.publicDir]            Astro's publicDir, for committed-file detection.
 * @param {boolean} [deps.deferred]          Collect and resolve every claim before writing.
 * @param {string} [deps.projectRoot]        Enables the private ownership manifest.
 * @param {string} [deps.base]               Astro base, used to form served pathnames.
 * @param {Iterable<string>} [deps.replacePaths] Exact core replacement authorizations.
 * @param {import('../index.js').Diagnostic[]} [deps.diagnostics]
 * @param {'off'|'warning'|'error'} [deps.failOn]
 * @param {'artifacts'|'recommended'|'off'} [deps.validationOnBuild]
 * @param {() => import('../index.js').Diagnostic[]} [deps.diagnosticsProvider]
 *   Supplies page-local diagnostics at commit time, after every staged lifecycle has run.
 * @param {() => void} [deps.onDiagnostics] Persist the sanitized diagnostics attempt.
 * @param {(operation: any, index: number) => void} [deps.beforeApply] Test seam for rollback.
 * @param {(result: { committed: boolean }) => void} [deps.onSettled] Release build-session resources.
 */
export function createArtifactWriter(deps) {
  return deps.deferred ? createDeferredArtifactWriter(deps) : createImmediateArtifactWriter(deps);
}

/** @param {Parameters<typeof createArtifactWriter>[0]} deps */
function createImmediateArtifactWriter({ distDir, logger, routePaths, routeMatchers, publicDir }) {
  const root = fileURLToPath(distDir);
  const routes = routePaths ? new Set([...routePaths].map(normalizePath)) : undefined;
  const matchers = routeMatchers ?? [];
  /** @type {Map<string, ArtifactOwner>} */
  const claimed = new Map();
  /** @type {Set<string>} */
  const prerenderedRouteDestinations = new Set();
  /** @type {Map<ArtifactOwner, number>} */
  const counts = new Map();

  /**
   * @param {Artifact} artifact
   * @returns {boolean} whether bytes were written
   */
  function write(artifact) {
    const { path, owner, route, onConflict, conflictMessage } = artifact;
    if (!path) throw new Error('astro-aeo: immediate artifact writes require an output path');
    const ownerKey = typeof owner === 'string' ? owner : /** @type {ArtifactOwner} */ (owner.name);

    const priorOwner = claimed.get(path);
    const destinationExists = pathEntryExists(path);
    const normalizedRoute = route ? normalizePath(route) : undefined;
    const onDemandRouteCollision = Boolean(
      normalizedRoute &&
        matchers.some(
          ({ pattern, prerendered }) => !prerendered && patternMatches(pattern, normalizedRoute),
        ),
    );
    const prerenderedRouteCollision = Boolean(
      normalizedRoute &&
        matchers.some(
          ({ pattern, prerendered }) => prerendered && patternMatches(pattern, normalizedRoute),
        ),
    );
    if (!priorOwner && destinationExists && prerenderedRouteCollision) {
      prerenderedRouteDestinations.add(path);
    }
    const projectRouteCollision = Boolean(
      normalizedRoute &&
        (routes?.has(normalizedRoute) ||
          onDemandRouteCollision ||
          prerenderedRouteDestinations.has(path)),
    );
    const publicRoot = publicDir ? fileURLToPath(publicDir) : undefined;
    const publicFile = publicRoot
      ? route
        ? join(publicRoot, route.replace(/^\/+/, ''))
        : pathWithin(publicRoot, path)
          ? path
          : undefined
      : undefined;
    const publicCollision = Boolean(publicFile && pathEntryExists(publicFile));

    const skipCollision =
      onConflict === 'skip' &&
      Boolean(destinationExists || priorOwner || projectRouteCollision || publicCollision);

    if (skipCollision) {
      if (destinationExists && conflictMessage) logger.warn(conflictMessage);
      if (priorOwner && priorOwner !== ownerKey) {
        logger.warn(
          `astro-aeo: ${ownerKey} and ${priorOwner} both claim ${displayPath(root, path)}. ` +
            `The existing ${priorOwner} output was retained by the skip policy.`,
        );
      }
      if (projectRouteCollision) {
        logger.warn(
          `astro-aeo: ${displayPath(root, path)} is also produced by a route in this project. ` +
            `The project route output was retained; turn off the ${ownerKey} output to remove this collision.`,
        );
      }
      if (publicCollision) {
        logger.warn(
          `astro-aeo: ${displayPath(root, path)} also exists in public/. ` +
            `The copied public file was retained; turn off the ${ownerKey} output to remove this collision.`,
        );
      }
      return false;
    }

    if (priorOwner && priorOwner !== ownerKey) {
      logger.warn(
        `astro-aeo: ${ownerKey} and ${priorOwner} both write ${displayPath(root, path)}. ` +
          'Change one of their output paths; the later write wins and the earlier output is lost.',
      );
    }

    if (projectRouteCollision) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} is also produced by a route in this project. ` +
          `Astro-AEO overwrote it; remove the route, or turn off the ${ownerKey} output.`,
      );
    }

    if (publicCollision) {
      logger.warn(
        `astro-aeo: ${displayPath(root, path)} also exists in public/. ` +
          `Astro-AEO overwrote the copied file; remove it, or turn off the ${ownerKey} output.`,
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

    claimed.set(path, ownerKey);
    counts.set(ownerKey, (counts.get(ownerKey) ?? 0) + 1);
    return true;
  }

  /** @param {string} path @param {(contents: string) => string} transform */
  function applyTransform(path, transform) {
    let contents;
    try {
      contents = readFileSync(path, 'utf8');
    } catch {
      return false;
    }
    const updated = transform(contents);
    if (updated !== contents) writeFileSync(path, updated, 'utf8');
    return updated !== contents;
  }

  /** @returns {{ total: number; byOwner: Partial<Record<ArtifactOwner, number>> }} */
  function ownershipReport() {
    /** @type {Partial<Record<ArtifactOwner, number>>} */
    const byOwner = {};
    let total = 0;
    for (const owner of OWNER_ORDER) {
      const count = counts.get(owner) ?? 0;
      if (!count) continue;
      byOwner[owner] = count;
      total += count;
    }
    return { total, byOwner };
  }

  return {
    isDeferred: false,
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
      const value = ownershipReport();

      const details = OWNER_ORDER.flatMap((owner) =>
        value.byOwner[owner] ? [`${owner}=${value.byOwner[owner]}`] : [],
      ).join(', ');
      logger.info(
        `astro-aeo: artifact registry wrote ${value.total} artifact(s)` +
          (details ? `: ${details}` : ''),
      );
      return value;
    },
    commit() {
      return ownershipReport();
    },
    /** @param {string} path @param {string} _owner @param {(contents: string) => string} transform */
    stageTransform(path, _owner, transform) {
      return applyTransform(path, transform);
    },
    /** @param {string} path @param {string} _owner @param {(contents: string) => string} transform */
    stageRedaction(path, _owner, transform) {
      return applyTransform(path, transform);
    },
    /** @param {string} _pathname */
    isPlannedStaleDeletion(_pathname) {
      return false;
    },
  };
}

export class ArtifactValidationError extends Error {
  /** @param {number} findings */
  constructor(findings) {
    super(`astro-aeo: artifact validation failed with ${findings} blocking diagnostic(s).`);
    this.name = 'ArtifactValidationError';
    this.findings = findings;
  }
}

/**
 * Normalize an untrusted browser-visible artifact pathname. The returned key is
 * decoded for matching; pathname is its stable URL spelling for manifests.
 * @param {unknown} value
 * @returns {{ key: string; pathname: string } | null}
 */
export function normalizeArtifactPathname(value) {
  try {
    const identity = exactPathnameIdentity(value, 'artifact pathname');
    if (identity.key === '/' || identity.key.split('/').slice(1).some((part) => !part)) return null;
    return identity;
  } catch {
    return null;
  }
}

/**
 * Astro route keys are already-decoded application paths, while configurable
 * exact artifact pathnames are validated in their canonical URL spelling. Core
 * callers use `route`, so encode that trusted route form before exact validation.
 * Already-encoded safe routes round-trip without being double encoded.
 * @param {string} pathname
 */
function canonicalInternalPathname(pathname) {
  const normalized = normalizePath(pathname);
  const inspected = inspectRootPathname(normalized);
  try {
    return encodeURI(inspected ? normalizePath(inspected.decoded) : normalized);
  } catch {
    return normalized;
  }
}

/** @param {string} base @returns {string} */
function canonicalBase(base) {
  if (!base || base === '/') return '';
  const pathname = canonicalInternalPathname(base);
  return inspectRootPathname(pathname) ? normalizePath(pathname) : '';
}

/** @param {string} base @returns {string} */
function normalizedBase(base) {
  const pathname = canonicalBase(base);
  const inspected = pathname ? inspectRootPathname(pathname) : null;
  return inspected ? normalizePath(inspected.decoded) : '';
}

/** @param {string} pathname @param {string} base */
function withBase(pathname, base) {
  const normalized = canonicalInternalPathname(pathname);
  const prefix = canonicalBase(base);
  if (!prefix) return normalized;
  return normalized === '/' ? prefix : `${prefix}${normalized}`;
}

/** @param {string} pathname */
function internalPathKey(pathname) {
  const inspected = inspectRootPathname(canonicalInternalPathname(pathname));
  return inspected ? normalizePath(inspected.decoded) : normalizePath(pathname);
}

/**
 * Convert one browser-visible pathname into its app-relative pathname. Astro's
 * configured base belongs in URLs, route ownership, and manifests, but its
 * client output and public directory are already mounted at that base and must
 * not contain a second physical base directory.
 * @param {string} pathname
 * @param {string} base
 * @returns {string | null}
 */
function withoutBase(pathname, base) {
  const normalized = normalizePath(pathname);
  const prefix = normalizedBase(base);
  if (!prefix) return normalized;
  if (normalized === prefix) return '/';
  return normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length) : null;
}

/** @param {string} root @param {string} servedKey @param {string} base */
function physicalArtifactPath(root, servedKey, base) {
  const appPath = withoutBase(servedKey, base);
  return appPath ? resolveRecordedOutputPath(root, appPath.replace(/^\/+/, '')) : null;
}

/** @param {unknown} owner */
function generatedOwner(owner) {
  if (
    owner &&
    typeof owner === 'object' &&
    (/** @type {any} */ (owner).kind === 'core' || /** @type {any} */ (owner).kind === 'plugin') &&
    typeof /** @type {any} */ (owner).name === 'string' &&
    /** @type {any} */ (owner).name
  ) {
    return {
      kind: /** @type {any} */ (owner).kind,
      name: /** @type {any} */ (owner).name,
      ...(typeof /** @type {any} */ (owner).claimId === 'string'
        ? { claimId: /** @type {any} */ (owner).claimId }
        : {}),
    };
  }
  return { kind: /** @type {const} */ ('core'), name: String(owner ?? 'unknown') };
}

/** @param {Artifact} artifact */
function artifactContent(artifact) {
  if (artifact.representation) {
    if (
      typeof artifact.representation.body !== 'string' ||
      !validContentType(artifact.representation.contentType)
    ) {
      return null;
    }
    return {
      contents: artifact.representation.body,
      contentType: artifact.representation.contentType,
    };
  }
  if (artifact.copyFrom) {
    // Snapshot copy sources when the claim is registered. The ownership hash
    // and the committed bytes must describe the same candidate even if another
    // integration mutates its source before the final transaction.
    return { contents: readFileSync(artifact.copyFrom), contentType: contentTypeFor(artifact) };
  }
  if (
    artifact.contents === undefined ||
    typeof artifact.contents === 'string' ||
    artifact.contents instanceof Uint8Array
  ) {
    return {
      contents: artifact.contents instanceof Uint8Array
        ? Buffer.from(artifact.contents)
        : artifact.contents ?? '',
      contentType: contentTypeFor(artifact),
    };
  }
  return null;
}

/** @param {string} value */
function validContentType(value) {
  return (
    typeof value === 'string' &&
    !/[\0-\x1f\x7f]/.test(value) &&
    /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+(?:\s*;[^\r\n]+)*$/.test(value)
  );
}

/** @param {Artifact} artifact */
function contentTypeFor(artifact) {
  if (artifact.contentType && validContentType(artifact.contentType)) return artifact.contentType;
  const owner = typeof artifact.owner === 'string' ? artifact.owner : artifact.owner?.name;
  if (owner === 'dotmd' || owner === 'urlMap') return 'text/markdown; charset=utf-8';
  if (owner === 'domainProfile') return 'application/json; charset=utf-8';
  if (owner === 'sitemapAlias') return 'application/xml; charset=utf-8';
  const pathname = artifact.pathname ?? artifact.route ?? '';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (pathname.endsWith('.gz')) return 'application/gzip';
  return 'text/plain; charset=utf-8';
}

/**
 * Deferred registry used by the integration build. Its `write()` method keeps
 * the existing generator API but records a claim instead of touching the file.
 * @param {Parameters<typeof createArtifactWriter>[0]} deps
 */
function createDeferredArtifactWriter(deps) {
  const {
    distDir,
    logger,
    routePaths,
    routeMatchers = [],
    publicDir,
    projectRoot,
    base = '',
    diagnostics = [],
    failOn = 'off',
    validationOnBuild = 'artifacts',
    diagnosticsProvider,
    onDiagnostics,
    beforeApply,
    onSettled,
  } = deps;
  const root = fileURLToPath(distDir);
  const publicRoot = publicDir ? fileURLToPath(publicDir) : undefined;
  const outputId = outputRootId(root);
  const previousManifest = readOwnershipManifest(projectRoot);
  const previousUsable = previousManifest?.outputRootId === outputId ? previousManifest : null;
  const previousBase = previousUsable && typeof previousUsable.base === 'string'
    ? previousUsable.base
    : base;
  const projectRoutes = new Set(
    [...(routePaths ?? [])].map(internalPathKey),
  );
  /** @type {Set<string>} */
  const replacements = new Set();
  /** @type {any[]} */
  const claims = [];
  /** @type {Map<string, { owner: string; transform: (contents: string) => string; redaction: boolean }[]>} */
  const transforms = new Map();
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {{ kind: 'write'; path: string; contents: string | Buffer | (() => string | Buffer); mode?: number; confineTo?: string }[]} */
  const privateWrites = [];
  /** @type {{ kind: 'delete'; path: string; confineTo?: string }[]} */
  const privateDeletes = [];
  /** @type {any} */
  let resolution;
  let committed = false;
  let settled = false;
  const diagnosticStart = diagnostics.length;
  const reportedDiagnosticKeys = new Set();

  for (const value of deps.replacePaths ?? []) {
    const normalized = normalizeArtifactPathname(value);
    if (normalized) replacements.add(normalized.key);
    else reportDiagnostic('artifact-invalid-replacement-path', 'error', `Invalid exact artifact replacement pathname: ${String(value)}`);
  }

  /** @param {string} code @param {'info'|'warning'|'error'} severity @param {string} message @param {string} [pathname] */
  function reportDiagnostic(code, severity, message, pathname) {
    const key = JSON.stringify([code, severity, message, pathname ?? null]);
    if (reportedDiagnosticKeys.has(key)) return;
    reportedDiagnosticKeys.add(key);
    diagnostics.push({ version: 1, code, severity, message, ...(pathname ? { pathname } : {}) });
    if (severity === 'warning' || severity === 'error') logger.warn(message);
  }

  /** @param {Artifact} artifact */
  function write(artifact) {
    if (committed || resolution) {
      throw new Error('astro-aeo: cannot register an artifact after ownership resolution');
    }
    const content = artifact.runtime
      ? { contents: '', contentType: 'application/octet-stream' }
      : artifactContent(artifact);
    if (!content) {
      reportDiagnostic('artifact-invalid-representation', 'error', 'astro-aeo: an artifact returned an invalid representation.');
      return false;
    }
    const rawPathname = artifact.pathname ?? (artifact.route ? withBase(artifact.route, base) : undefined);
    const served = rawPathname === undefined ? null : normalizeArtifactPathname(rawPathname);
    if (rawPathname !== undefined && !served) {
      reportDiagnostic('artifact-invalid-pathname', 'error', `astro-aeo: invalid exact artifact pathname ${String(rawPathname)}.`);
      return false;
    }
    // A served pathname is the sole authority for its output location. Do not
    // let a plugin smuggle a second filesystem destination alongside a safe URL.
    // Legacy core callers still pass `path`, but route claims are intentionally
    // remapped here. The configured base remains part of the served pathname;
    // Astro mounts the physical client output at that base already.
    let destination = served
      ? physicalArtifactPath(root, served.key, base)
      : artifact.path;
    if (!destination) {
      reportDiagnostic(
        'artifact-invalid-destination',
        'error',
        served
          ? `astro-aeo: ${served.pathname} cannot be mapped to a safe build-output destination.`
          : 'astro-aeo: an internal project-file artifact requires a destination.',
        served?.pathname,
      );
      return false;
    }
    claims.push({
      id: claims.length,
      artifact: { ...artifact, path: destination },
      owner: generatedOwner(artifact.owner),
      served,
      content,
      group: typeof artifact.group === 'string' && artifact.group ? artifact.group : undefined,
    });
    return true;
  }

  /** @param {string} path @param {string} owner @param {(contents: string) => string} transform */
  function stageTransform(path, owner, transform) {
    if (committed || resolution) {
      throw new Error('astro-aeo: cannot register an HTML transform after ownership resolution');
    }
    const list = transforms.get(path) ?? [];
    list.push({ owner, transform, redaction: false });
    transforms.set(path, list);
    return true;
  }

  /**
   * Register a confidentiality transform. Redactions run last on success and
   * are the only transforms applied before a validation or commit error is
   * rethrown, so collection markers cannot leak into failed build output.
   * @param {string} path
   * @param {string} owner
   * @param {(contents: string) => string} transform
   */
  function stageRedaction(path, owner, transform) {
    if (committed || resolution) {
      throw new Error('astro-aeo: cannot register a redaction after ownership resolution');
    }
    const list = transforms.get(path) ?? [];
    list.push({ owner, transform, redaction: true });
    transforms.set(path, list);
    return true;
  }

  /**
   * Stage a private build-state write in the same rollback boundary as public
   * artifacts and ownership. The value may be produced at commit time so the
   * final diagnostic/ownership decisions are represented.
   * @param {string} path
   * @param {string | Buffer | (() => string | Buffer)} contents
   * @param {{ mode?: number; confineTo?: string }} [options]
   */
  function stagePrivateWrite(path, contents, options = {}) {
    if (committed || resolution) {
      throw new Error('astro-aeo: cannot register private state after ownership resolution');
    }
    if (typeof path !== 'string' || !path) {
      throw new TypeError('astro-aeo: private state requires a non-empty destination');
    }
    if (
      typeof contents !== 'string' &&
      !Buffer.isBuffer(contents) &&
      typeof contents !== 'function'
    ) {
      throw new TypeError('astro-aeo: private state must be text, bytes, or a producer');
    }
    privateWrites.push({ kind: 'write', path, contents, ...options });
    return true;
  }

  /**
   * Stage deletion of a coordinator-owned private state file.
   * @param {string} path
   * @param {{ confineTo?: string }} [options]
   */
  function stagePrivateDelete(path, options = {}) {
    if (committed || resolution) {
      throw new Error('astro-aeo: cannot register private state after ownership resolution');
    }
    if (typeof path !== 'string' || !path) {
      throw new TypeError('astro-aeo: private state requires a non-empty destination');
    }
    privateDeletes.push({ kind: 'delete', path, ...options });
    return true;
  }

  /** @param {boolean} [finalize] */
  function resolveClaims(finalize = true) {
    if (resolution) return resolution;
    /** @type {Map<number, any>} */
    const decisions = new Map();
    /** @type {Map<number, Set<number>>} */
    const conflictPeers = new Map();
    /** @type {Map<string, any[]>} */
    const byServed = new Map();
    /** @type {Map<string, any[]>} */
    const byDestination = new Map();
    const reportedConflictGroups = new Set();

    for (const claim of claims) {
      if (claim.served) {
        const list = byServed.get(claim.served.key) ?? [];
        list.push(claim);
        byServed.set(claim.served.key, list);
      }
      // Middleware-only claims reserve served pathnames but never create a
      // filesystem entry. Their synthetic destination must not participate in
      // file-versus-directory ancestry checks.
      if (!claim.artifact.runtime) {
        const physical = byDestination.get(claim.artifact.path) ?? [];
        physical.push(claim);
        byDestination.set(claim.artifact.path, physical);
      }
    }

    const markConflict = (/** @type {any[]} */ related, /** @type {string} */ label) => {
      if (related.length < 2) return;
      for (const claim of related) {
        const peers = conflictPeers.get(claim.id) ?? new Set();
        for (const peer of related) peers.add(peer.id);
        conflictPeers.set(claim.id, peers);
        decisions.set(claim.id, { status: 'conflict' });
      }
      const conflictKey = related.map((claim) => claim.id).sort((a, b) => a - b).join(',');
      if (reportedConflictGroups.has(conflictKey)) return;
      reportedConflictGroups.add(conflictKey);
      const pathname = related.find((claim) => claim.served)?.served.pathname;
      const claimants = related
        .map((claim) =>
          `${claim.owner.kind} "${claim.owner.name}"` +
          (claim.owner.claimId ? ` claim "${claim.owner.claimId}"` : ''),
        )
        .sort()
        .join(', ');
      reportDiagnostic(
        'artifact-generated-conflict',
        'error',
        `astro-aeo: generated artifact claims from ${claimants} conflict at ${label}; no claimant was emitted. Change one claimant's exact output pathname.`,
        pathname,
      );
    };
    for (const [key, related] of byServed) markConflict(related, related[0].served.pathname ?? key);
    for (const [path, related] of byDestination) markConflict(related, artifactPathLabel(path));
    const destinations = [...byDestination.entries()];
    for (let left = 0; left < destinations.length; left++) {
      for (let right = left + 1; right < destinations.length; right++) {
        const [leftPath, leftClaims] = destinations[left];
        const [rightPath, rightClaims] = destinations[right];
        if (!pathWithin(leftPath, rightPath) && !pathWithin(rightPath, leftPath)) continue;
        markConflict(
          [...leftClaims, ...rightClaims],
          `${artifactPathLabel(leftPath)} and ${artifactPathLabel(rightPath)}`,
        );
      }
    }

    for (const claim of claims) {
      if (decisions.has(claim.id)) continue;
      if (!claim.served) {
        if (pathEntryExists(claim.artifact.path)) {
          decisions.set(claim.id, { status: 'preserved', blockers: [{ kind: 'existing-output' }] });
          reportDiagnostic(
            'url-map-existing-output',
            'warning',
            `astro-aeo: ${artifactPathLabel(claim.artifact.path)} already exists; the project-root URL map was preserved. Choose a different output path.`,
          );
        } else {
          decisions.set(claim.id, { status: 'emit', blockers: [] });
        }
        continue;
      }

      const blockers = externalOwnersFor(claim);
      const stale = blockers.length === 1 && blockers[0].kind === 'existing-output' && isPriorOwned(claim);
      if (stale) blockers.length = 0;
      const authorized = claim.owner.kind === 'plugin'
        ? claim.artifact.replace === true
        : replacements.has(claim.served.key);
      if (blockers.length && !authorized) {
        decisions.set(claim.id, { status: 'preserved', blockers });
        reportDiagnostic(
          'artifact-external-owner-preserved',
          'warning',
          `astro-aeo: ${claim.served.pathname} is owned by ${blockers.map(ownerLabel).join(' and ')}. The existing output was retained; add the exact path to artifacts.replace for a core artifact, or set replace: true on the plugin claim.`,
          claim.served.pathname,
        );
      } else {
        decisions.set(claim.id, { status: 'emit', blockers });
        if (blockers.length) {
          reportDiagnostic(
            'artifact-external-owner-replaced',
            'info',
            `astro-aeo: ${claim.served.pathname} replaced ${blockers.map(ownerLabel).join(' and ')} by exact authorization.`,
            claim.served.pathname,
          );
        }
      }
    }

    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const claim of claims) {
      if (!claim.group) continue;
      const list = groups.get(claim.group) ?? [];
      list.push(claim);
      groups.set(claim.group, list);
    }
    for (const [group, members] of groups) {
      const causes = members.filter((member) => decisions.get(member.id)?.status !== 'emit');
      if (!causes.length) continue;
      const causedBy = causes.flatMap((member) => member.served ? [member.served.pathname] : []);
      for (const member of members) {
        if (decisions.get(member.id)?.status === 'emit') {
          decisions.set(member.id, { status: 'group-skipped', group, causedBy });
        }
      }
      reportDiagnostic(
        'artifact-group-skipped',
        'warning',
        `astro-aeo: atomic artifact group ${group} was skipped because not every member could be emitted.`,
      );
    }

    const manifestEntries = buildManifestEntries(byServed, decisions, conflictPeers);
    const manifestGroups = [...groups.entries()].map(([id, members]) => ({
      id,
      mode: 'all-or-none',
      pathnames: members.flatMap((member) => member.served ? [member.served.pathname] : []).sort(),
      status: members.every((member) => decisions.get(member.id)?.status === 'emit') ? 'emitted' : 'skipped',
    })).sort((a, b) => a.id.localeCompare(b.id));

    const value = { decisions, manifestEntries, manifestGroups, byServed };
    if (finalize) resolution = value;
    return value;
  }

  /** @param {any} claim */
  function externalOwnersFor(claim) {
    /** @type {any[]} */
    const owners = [];
    if (projectRouteOwns(claim.served.key)) {
      owners.push({ kind: 'project-route', rendering: projectRendering(claim.served.key) });
    }
    const publicPath = publicRoot
      ? physicalArtifactPath(publicRoot, claim.served.key, base)
      : undefined;
    if (
      publicPath &&
      pathEntryExists(publicPath) &&
      (!claim.artifact.runtime || !pathEntryIsDirectory(publicPath))
    ) {
      owners.push({ kind: 'public-file' });
    }
    if (
      !claim.artifact.runtime &&
      pathEntryExists(claim.artifact.path) &&
      owners.length === 0
    ) {
      owners.push({ kind: 'existing-output' });
    }
    return owners;
  }

  /** @param {string} servedKey @param {string} [servedBase] */
  function projectRouteOwns(servedKey, servedBase = base) {
    const appPath = withoutBase(servedKey, servedBase);
    if (!appPath) return false;
    if (projectRoutes.has(appPath)) return true;
    return routeMatchers.some(({ pattern, prerendered }) => {
      const physicalPath = physicalArtifactPath(root, servedKey, servedBase);
      if (prerendered && (!physicalPath || !pathEntryExists(physicalPath))) return false;
      return patternMatches(pattern, appPath) || patternMatches(pattern, servedKey);
    });
  }

  /** @param {string} servedKey @returns {'prerendered'|'on-demand'} */
  function projectRendering(servedKey) {
    const appPath = withoutBase(servedKey, base) ?? servedKey;
    return routeMatchers.some(({ pattern, prerendered }) => !prerendered && (patternMatches(pattern, appPath) || patternMatches(pattern, servedKey)))
      ? 'on-demand'
      : 'prerendered';
  }

  /** @param {any} claim */
  function isPriorOwned(claim) {
    if (!previousUsable || !claim.served) return false;
    const outputPath = relativeOutputPath(root, claim.artifact.path);
    if (!outputPath) return false;
    const previous = previousUsable.artifacts.find(
      (/** @type {any} */ entry) =>
        entry?.status === 'emitted' && entry.outputPath === outputPath,
    );
    return Boolean(
      previous?.representation?.etag &&
      pathEntryIsRegularFile(claim.artifact.path) &&
      fileEtag(claim.artifact.path) === previous.representation.etag
    );
  }

  /** @param {Map<string, any[]>} byServed @param {Map<number, any>} decisions @param {Map<number, Set<number>>} conflictPeers */
  function buildManifestEntries(byServed, decisions, conflictPeers) {
    const entries = [];
    for (const related of byServed.values()) {
      const claim = related[0];
      const decision = decisions.get(claim.id);
      if (decision.status === 'conflict') {
        const peers = [...(conflictPeers.get(claim.id) ?? new Set([claim.id]))]
          .map((id) => claims[id]);
        const owners = new Map();
        for (const peer of peers) {
          const key = `${peer.owner.kind}:${peer.owner.name}`;
          const value = owners.get(key) ?? { owner: peer.owner, count: 0 };
          value.count++;
          owners.set(key, value);
        }
        entries.push({
          pathname: claim.served.pathname,
          status: 'conflict',
          claimants: [...owners.values()].sort(compareClaimants),
          ...(claim.group ? { group: claim.group } : {}),
        });
        continue;
      }
      if (decision.status === 'preserved') {
        entries.push({
          pathname: claim.served.pathname,
          status: 'preserved',
          owner: claim.owner,
          blockingOwners: decision.blockers,
          ...(claim.group ? { group: claim.group } : {}),
        });
        continue;
      }
      if (decision.status === 'group-skipped') {
        entries.push({
          pathname: claim.served.pathname,
          status: 'group-skipped',
          owner: claim.owner,
          group: claim.group,
          causedBy: decision.causedBy,
        });
        continue;
      }
      if (claim.artifact.runtime) {
        entries.push({
          pathname: claim.served.pathname,
          status: 'runtime',
          owner: claim.owner,
          ...(decision.blockers.length ? { replacedOwners: decision.blockers } : {}),
          ...(claim.group ? { group: claim.group } : {}),
        });
        continue;
      }
      const outputPath = relativeOutputPath(root, claim.artifact.path);
      if (!outputPath) continue;
      entries.push({
        pathname: claim.served.pathname,
        status: 'emitted',
        owner: claim.owner,
        outputPath,
        representation: {
          contentType: claim.content.contentType,
          ...representationMetadata(claim.content.contents),
        },
        ...(decision.blockers.length ? { replacedOwners: decision.blockers } : {}),
        ...(claim.group ? { group: claim.group } : {}),
      });
    }
    return entries.sort((a, b) => codeUnitCompare(a.pathname, b.pathname));
  }

  function commit() {
    if (committed) return ownershipReport();
    let resolved;
    let recommendedDiagnostics = diagnostics;
    try {
      resolved = resolveClaims();
      if (validationOnBuild === 'recommended' && diagnosticsProvider) {
        recommendedDiagnostics = uniqueDiagnostics([
          ...diagnostics,
          ...diagnosticsProvider(),
        ]);
      }
      onDiagnostics?.();
    } catch (error) {
      throwAfterRedactions(error);
    }
    const validationDiagnostics = validationOnBuild === 'recommended'
      ? recommendedDiagnostics
      : validationOnBuild === 'artifacts'
        ? diagnostics.slice(diagnosticStart)
        : [];
    const thresholdBlocking = validationDiagnostics.filter((diagnostic) =>
      failOn === 'warning'
        ? diagnostic.severity === 'warning' || diagnostic.severity === 'error'
        : failOn === 'error'
          ? diagnostic.severity === 'error'
          : false,
    );
    const mandatory = diagnostics
      .slice(diagnosticStart)
      .filter((diagnostic) => MANDATORY_ARTIFACT_CODES.has(diagnostic.code));
    const blocking = uniqueDiagnostics([...thresholdBlocking, ...mandatory]);
    if (blocking.length) {
      throwAfterRedactions(new ArtifactValidationError(blocking.length));
    }

    try {
      /** @type {import('./transaction.js').FileOperation[]} */
      const operations = [];
      counts.clear();
      for (const claim of claims) {
        if (resolved.decisions.get(claim.id)?.status !== 'emit') continue;
        if (claim.artifact.runtime) {
          if (
            pathEntryExists(claim.artifact.path) &&
            !pathEntryIsDirectory(claim.artifact.path)
          ) {
            operations.push({ kind: 'delete', path: claim.artifact.path });
          }
          continue;
        }
        operations.push({
          kind: 'write',
          path: claim.artifact.path,
          contents: claim.content.contents,
        });
        const key = ownerCountKey(claim.owner);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      operations.push(...transformOperations(false));
      operations.push(...staleCleanupOperations(resolved.byServed));

      for (const operation of privateWrites) {
        const contents = typeof operation.contents === 'function'
          ? operation.contents()
          : operation.contents;
        operations.push({
          kind: 'write',
          path: operation.path,
          contents,
          mode: operation.mode ?? 0o600,
          ...(operation.confineTo ? { confineTo: operation.confineTo } : {}),
        });
      }
      operations.push(...privateDeletes);

      if (projectRoot) {
        const manifest = {
          version: 1,
          generatedAt: new Date().toISOString(),
          base: canonicalBase(base) || '/',
          outputRootId: outputId,
          artifacts: resolved.manifestEntries,
          groups: resolved.manifestGroups,
        };
        operations.push({
          kind: 'write',
          path: ownershipManifestPath(projectRoot),
          contents: serializeOwnershipManifest(manifest),
          mode: 0o600,
        });
      }

      commitFileTransaction(operations.map(confineOperation), { beforeApply });
      committed = true;
    } catch (error) {
      counts.clear();
      reportDiagnostic(
        'artifact-commit-failed',
        'error',
        'astro-aeo: the artifact transaction failed and was rolled back.',
      );
      // A staged transform can discover a diagnostic after the initial
      // manifest snapshot. Persist again only after the transaction failure
      // finding has joined it, so the failed attempt remains fully auditable.
      throwAfterRedactions(error, true);
    } finally {
      settle(committed);
    }
    return ownershipReport();
  }

  /** @param {boolean} didCommit */
  function settle(didCommit) {
    if (settled) return;
    settled = true;
    onSettled?.({ committed: didCommit });
  }

  /**
   * @param {boolean} redactionsOnly
   * @returns {import('./transaction.js').FileOperation[]}
   */
  function transformOperations(redactionsOnly) {
    /** @type {import('./transaction.js').FileOperation[]} */
    const operations = [];
    for (const [path, edits] of transforms) {
      const selected = redactionsOnly
        ? edits.filter((edit) => edit.redaction)
        : [
            ...edits.filter((edit) => !edit.redaction),
            ...edits.filter((edit) => edit.redaction),
          ];
      if (!selected.length) continue;
      let contents;
      try {
        contents = readFileSync(path, 'utf8');
      } catch (error) {
        if (isMissingError(error)) continue;
        throw error;
      }
      let updated = contents;
      for (const edit of selected) updated = edit.transform(updated);
      if (typeof updated !== 'string') {
        throw new TypeError(`astro-aeo: ${selected[0].owner} returned a non-string HTML transform.`);
      }
      if (updated !== contents) operations.push({ kind: 'write', path, contents: updated });
    }
    return operations;
  }

  /**
   * Confidentiality cleanup is intentionally per file: one unreadable output
   * must not stop markers from being removed from every other page.
   * @returns {unknown[]}
   */
  function applyEmergencyRedactions() {
    /** @type {unknown[]} */
    const failures = [];
    for (const operation of transformOperationsSafely()) {
      if ('error' in operation) {
        failures.push(operation.error);
        continue;
      }
      try {
        commitFileTransaction([confineOperation(operation)]);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  /** @returns {({ kind: 'write'; path: string; contents: string } | { error: unknown })[]} */
  function transformOperationsSafely() {
    const results = [];
    for (const [path, edits] of transforms) {
      const redactions = edits.filter((edit) => edit.redaction);
      if (!redactions.length) continue;
      try {
        let contents;
        try {
          contents = readFileSync(path, 'utf8');
        } catch (error) {
          if (isMissingError(error)) continue;
          throw error;
        }
        let updated = contents;
        for (const edit of redactions) updated = edit.transform(updated);
        if (typeof updated !== 'string') {
          throw new TypeError(`astro-aeo: ${redactions[0].owner} returned a non-string redaction.`);
        }
        if (updated !== contents) results.push({ kind: /** @type {const} */ ('write'), path, contents: updated });
      } catch (error) {
        results.push({ error });
      }
    }
    return results;
  }

  /**
   * @param {unknown} error
   * @param {boolean} [persistDiagnostics]
   * @returns {never}
   */
  function throwAfterRedactions(error, persistDiagnostics = false) {
    const failures = applyEmergencyRedactions();
    if (failures.length) {
      reportDiagnostic(
        'artifact-redaction-failed',
        'error',
        `astro-aeo: ${failures.length} mandatory marker redaction(s) failed while aborting the build.`,
      );
    }
    if (persistDiagnostics) {
      try {
        onDiagnostics?.();
      } catch (diagnosticError) {
        failures.push(diagnosticError);
      }
    }
    if (failures.length) {
      settle(false);
      throw new AggregateError(
        [error, ...failures],
        'astro-aeo: the build failed and one or more mandatory marker redactions could not be completed.',
      );
    }
    settle(false);
    throw error;
  }

  /** @param {Map<string, any[]>} currentClaims */
  function staleCleanupOperations(currentClaims) {
    if (!previousUsable) return [];
    const currentOutputPaths = new Set(
      [...currentClaims.values()].flatMap((related) =>
        related.flatMap((claim) => {
          const outputPath = relativeOutputPath(root, claim.artifact.path);
          return outputPath ? [outputPath] : [];
        }),
      ),
    );
    const candidates = previousUsable.artifacts.filter(
      (/** @type {any} */ entry) => {
        return entry?.status === 'emitted' && !currentOutputPaths.has(entry.outputPath);
      },
    );
    /** @type {Map<string, any[]>} */
    const priorGroups = new Map();
    const ungrouped = [];
    for (const entry of candidates) {
      if (entry.group) {
        const list = priorGroups.get(entry.group) ?? [];
        list.push(entry);
        priorGroups.set(entry.group, list);
      } else {
        ungrouped.push(entry);
      }
    }
    const safe = (/** @type {any} */ entry) => {
      const served = normalizeArtifactPathname(entry.pathname);
      const path = resolveRecordedOutputPath(root, entry.outputPath);
      if (!served || !path || projectRouteOwns(served.key, previousBase)) return null;
      const publicPath = publicRoot
        ? physicalArtifactPath(publicRoot, served.key, previousBase)
        : undefined;
      if (publicPath && pathEntryExists(publicPath)) return null;
      if (!pathEntryIsRegularFile(path)) return null;
      if (fileEtag(path) !== entry.representation?.etag) return null;
      return path;
    };
    const deletes = ungrouped.flatMap((entry) => {
      const path = safe(entry);
      return path ? [{ kind: /** @type {const} */ ('delete'), path }] : [];
    });
    for (const entries of priorGroups.values()) {
      const paths = entries.map(safe);
      if (paths.every(Boolean)) {
        for (const path of paths) deletes.push({ kind: 'delete', path: /** @type {string} */ (path) });
      }
    }
    return deletes;
  }

  /** @param {string} pathname */
  function isPlannedStaleDeletion(pathname) {
    const served = normalizeArtifactPathname(withBase(pathname, base));
    if (!served) return false;
    const destination = physicalArtifactPath(root, served.key, base);
    if (!destination) return false;
    /** @type {Map<string, any[]>} */
    const currentClaims = new Map();
    for (const claim of claims) {
      if (!claim.served) continue;
      const related = currentClaims.get(claim.served.key) ?? [];
      related.push(claim);
      currentClaims.set(claim.served.key, related);
    }
    return staleCleanupOperations(currentClaims).some(
      (operation) => operation.kind === 'delete' && operation.path === destination,
    );
  }

  /** @param {import('./transaction.js').FileOperation} operation */
  function confineOperation(operation) {
    const confineTo = pathWithin(root, operation.path)
      ? root
      : projectRoot && pathWithin(projectRoot, operation.path)
        ? projectRoot
        : undefined;
    return confineTo ? { ...operation, confineTo } : operation;
  }

  function ownershipReport() {
    /** @type {Record<string, number>} */
    const byOwner = {};
    let total = 0;
    for (const [owner, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      byOwner[owner] = count;
      total += count;
    }
    return { total, byOwner };
  }

  /** @param {string} path */
  function artifactPathLabel(path) {
    if (pathWithin(root, path)) return displayPath(root, path);
    if (projectRoot && pathWithin(projectRoot, path)) return displayPath(projectRoot, path);
    return '<external artifact path>';
  }

  function report() {
    const value = commit();
    const details = Object.entries(value.byOwner).map(([owner, count]) => `${owner}=${count}`).join(', ');
    logger.info(
      `astro-aeo: artifact registry wrote ${value.total} artifact(s)` +
        (details ? `: ${details}` : ''),
    );
    return value;
  }

  return {
    isDeferred: true,
    write,
    /** @param {Artifact[]} artifacts */
    writeAll(artifacts) {
      let written = 0;
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
    stageTransform,
    stageRedaction,
    stagePrivateWrite,
    stagePrivateDelete,
    isPlannedStaleDeletion,
    commit,
    report,
    resolve: resolveClaims,
    preview() {
      return resolveClaims(false);
    },
  };
}

/** @param {string} left @param {string} right */
function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** @param {any} owner */
function ownerLabel(owner) {
  if (owner.kind === 'project-route') return 'a project route';
  if (owner.kind === 'public-file') return 'public/';
  return 'existing build output';
}

/** @param {import('../index.js').Diagnostic[]} diagnostics */
function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([
      diagnostic.version,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.pathname ?? null,
      diagnostic.sourcePath ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {{ owner: { kind: string; name: string } }} a @param {{ owner: { kind: string; name: string } }} b */
function compareClaimants(a, b) {
  return `${a.owner.kind}:${a.owner.name}`.localeCompare(`${b.owner.kind}:${b.owner.name}`);
}

/** @param {{ kind: string; name: string }} owner */
function ownerCountKey(owner) {
  return owner.kind === 'plugin' ? `plugin:${owner.name}` : owner.name;
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

/** @param {string} path */
function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path */
function pathEntryIsDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path */
function pathEntryIsRegularFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAlreadyExistsError(err) {
  return Boolean(err) && /** @type {any} */ (err).code === 'EEXIST';
}

/** @param {unknown} err */
function isMissingError(err) {
  return Boolean(err) && /** @type {any} */ (err).code === 'ENOENT';
}

/**
 * RegExp instances from Astro are shared with other integration state. Reset
 * stateful patterns before and after testing so `g` or `y` flags cannot make
 * collision detection depend on call order.
 * @param {RegExp} pattern
 * @param {string} route
 * @returns {boolean}
 */
function patternMatches(pattern, route) {
  for (const candidate of route === '/' ? [route] : [route, `${route}/`]) {
    pattern.lastIndex = 0;
    if (pattern.test(candidate)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  pattern.lastIndex = 0;
  return false;
}
