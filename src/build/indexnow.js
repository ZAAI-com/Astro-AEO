// @ts-check
import { chmodSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INDEXNOW_ACK_FILENAME,
  INDEXNOW_PENDING_FILENAME,
  INDEXNOW_PREPARE_INPUT_FILENAME,
  fingerprintIndexNowPage,
  normalizeOrigin,
  parseIndexNowAcknowledgment,
  parseIndexNowQueue,
} from './indexnow-state.js';

export const INDEXNOW_PUBLIC_PATH = '/.well-known/astro-aeo-indexnow-v1.json';
export const INDEXNOW_PREPARE_PROVIDER = Symbol.for('astro-aeo.indexnow.prepare-input');

/** @param {string} projectRoot */
export function indexNowPaths(projectRoot) {
  const directory = join(projectRoot, '.astro', 'aeo-cache', 'indexnow');
  return {
    directory,
    acknowledgment: join(directory, INDEXNOW_ACK_FILENAME),
    pending: join(directory, INDEXNOW_PENDING_FILENAME),
    prepareInput: join(directory, INDEXNOW_PREPARE_INPUT_FILENAME),
    progress: join(directory, 'progress-v1.json'),
  };
}

/** @param {string} projectRoot */
export function ensureIndexNowPrivateDirectory(projectRoot) {
  const directory = indexNowPaths(projectRoot).directory;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch {}
  return directory;
}

/**
 * Load only strictly validated, regular non-symlink ledgers. A malformed file
 * or interrupted submit journal removes all acknowledgment/deletion authority
 * from this build and prevents it from replacing the prior private state.
 * @param {string} projectRoot
 */
export function readIndexNowPrivateState(projectRoot) {
  const paths = indexNowPaths(projectRoot);
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];
  if (safeEntryExists(paths.progress)) {
    diagnostics.push(indexNowStateDiagnostic(
      'indexnow-state-in-progress',
      'An unfinished IndexNow submission journal exists; this build treats notification state as read-only.',
    ));
    return emptyPrivateState(paths, diagnostics, true);
  }
  try {
    const acknowledgment = readOptional(paths.acknowledgment, parseIndexNowAcknowledgment, { version: 1, origins: [] });
    const queue = readOptional(paths.pending, parseIndexNowQueue, { version: 1, origins: [] });
    return { paths, acknowledgment, queue, readOnly: false, diagnostics };
  } catch {
    diagnostics.push(indexNowStateDiagnostic(
      'indexnow-state-invalid',
      'IndexNow private state is invalid or unsafe; this build is cold and will not replace notification state.',
    ));
    return emptyPrivateState(paths, diagnostics, true);
  }
}

/**
 * Fingerprint indexable canonical HTML pages. A failed normalization preserves
 * the last acknowledged fingerprint for that URL, preventing a false removal.
 * @param {import('../core/page-model.js').AeoPageRecord[]} pages
 * @param {{
 *   acknowledged?: import('./indexnow-state.js').UrlFingerprint[];
 *   graphFor?: (page: import('../core/page-model.js').AeoPageRecord) => unknown;
 *   origins?: Iterable<string>;
 * }} [options]
 */
export function collectIndexNowFingerprints(pages, options = {}) {
  const prior = new Map((options.acknowledged ?? []).map((item) => [item.url, item]));
  const allowedOrigins = options.origins
    ? new Set([...options.origins].map(normalizeOrigin))
    : undefined;
  /** @type {Map<string, import('./indexnow-state.js').UrlFingerprint>} */
  const current = new Map();
  const conflicted = new Set();
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];

  for (const page of pages) {
    if (page.directives?.index === false || page.pathname === '/404' || page.pathname === '/500') continue;
    const canonical = page.canonicalUrl ?? page.url;
    let parsed;
    try { parsed = new URL(canonical); }
    catch {
      diagnostics.push(pageDiagnostic('indexnow-canonical-invalid', page, 'The page has no valid absolute canonical URL and was excluded from IndexNow.'));
      continue;
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.pathname.endsWith('.md')
    ) {
      diagnostics.push(pageDiagnostic('indexnow-canonical-unsafe', page, 'The page canonical is not a safe HTTPS HTML URL and was excluded from IndexNow.'));
      continue;
    }
    const origin = parsed.origin;
    if (allowedOrigins && !allowedOrigins.has(origin)) {
      diagnostics.push(pageDiagnostic('indexnow-origin-unconfigured', page, 'The page canonical origin is not configured for IndexNow and was excluded.'));
      continue;
    }
    const url = parsed.href;
    try {
      const fingerprint = fingerprintIndexNowPage({
        canonicalUrl: url,
        markdown: page.representations?.markdown ?? page.markdown ?? '',
        metadata: {
          metadata: page.metadata,
          dates: page.dates ?? null,
          authors: page.authors ?? [],
        },
        directives: page.directives,
        locale: page.locale ?? null,
        language: page.language ?? null,
        alternates: page.alternates ?? [],
        graph: options.graphFor?.(page) ?? null,
      });
      if (conflicted.has(url)) continue;
      const existing = current.get(url);
      if (existing && existing.fingerprint !== fingerprint) {
        diagnostics.push(pageDiagnostic('indexnow-canonical-conflict', page, 'Multiple pages produced different semantic fingerprints for one canonical URL.'));
        const acknowledged = prior.get(url);
        if (acknowledged) current.set(url, acknowledged);
        else current.delete(url);
        conflicted.add(url);
        continue;
      }
      current.set(url, { url, fingerprint });
    } catch {
      diagnostics.push(pageDiagnostic('indexnow-fingerprint-failed', page, 'The page could not be normalized for IndexNow; its prior acknowledged fingerprint was retained when available.'));
      const acknowledged = prior.get(url);
      if (acknowledged) current.set(url, acknowledged);
    }
  }

  return {
    current: [...current.values()].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
    diagnostics,
  };
}

/** @param {string} value */
export function indexNowStatePathname(value) {
  const base = value && value !== '/' ? `/${value.replace(/^\/+|\/+$/g, '')}` : '';
  return `${base}${INDEXNOW_PUBLIC_PATH}`;
}

/** @param {string} path @param {(value: unknown) => any} parser @param {any} fallback */
function readOptional(path, parser, fallback) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return fallback;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('unsafe private state');
  return parser(JSON.parse(readFileSync(path, 'utf8')));
}

/** @param {string} path */
function safeEntryExists(path) {
  try {
    const stat = lstatSync(path);
    return !stat.isFile() || stat.isSymbolicLink() || stat.size >= 0;
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    return true;
  }
}

/** @param {ReturnType<typeof indexNowPaths>} paths @param {import('../index.js').Diagnostic[]} diagnostics @param {boolean} readOnly */
function emptyPrivateState(paths, diagnostics, readOnly) {
  return {
    paths,
    acknowledgment: /** @type {import('./indexnow-state.js').IndexNowAcknowledgmentV1} */ ({ version: 1, origins: [] }),
    queue: /** @type {import('./indexnow-state.js').IndexNowQueueV1} */ ({ version: 1, origins: [] }),
    readOnly,
    diagnostics,
  };
}

/** @param {string} code @param {string} message */
function indexNowStateDiagnostic(code, message) {
  return { version: /** @type {const} */ (1), code, severity: /** @type {const} */ ('warning'), message };
}

/** @param {string} code @param {import('../core/page-model.js').AeoPageRecord} page @param {string} message */
function pageDiagnostic(code, page, message) {
  return { version: /** @type {const} */ (1), code, severity: /** @type {const} */ ('error'), message, pathname: page.pathname };
}
