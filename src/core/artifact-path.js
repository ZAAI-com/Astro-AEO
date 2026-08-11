// @ts-check
import { inspectRootPathname } from './match.js';

/**
 * Require one canonical, exact URL pathname spelling for configured artifact
 * ownership. The returned value remains encoded for manifests and links.
 *
 * @param {unknown} path
 * @param {string} [label]
 * @returns {string}
 */
export function assertExactPathname(path, label = 'pathname') {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/' || path.startsWith('//')) {
    throw new TypeError(`${label} must be an exact absolute served pathname below root.`);
  }
  const hasControl = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (hasControl || /[\\?#*{}\[\]]/.test(path) || path.endsWith('/') || path.includes('//')) {
    throw new TypeError(`${label} must be normalized and contain no query, fragment, glob, or trailing slash.`);
  }
  if (/%(?:2f|5c)/i.test(path)) {
    throw new TypeError(`${label} must not contain encoded path separators.`);
  }
  const inspected = inspectRootPathname(path);
  if (!inspected) throw new TypeError(`${label} contains malformed or unsafe URL encoding.`);
  try {
    if (
      /%[0-9a-f]{2}/i.test(inspected.decoded) ||
      encodeURI(inspected.decoded) !== path
    ) {
      throw new TypeError(`${label} must use one unambiguous normalized URL spelling.`);
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('unambiguous normalized')) throw error;
    throw new TypeError(`${label} must use one unambiguous normalized URL spelling.`);
  }
  return path;
}

/**
 * Return both forms needed by artifact ownership: an encoded public pathname
 * and the once-decoded key used to compare it with Astro request pathnames.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {{ pathname: string; key: string }}
 */
export function exactPathnameIdentity(value, label = 'pathname') {
  const pathname = assertExactPathname(value, label);
  const inspected = inspectRootPathname(pathname);
  if (!inspected) throw new TypeError(`${label} must be an exact absolute served pathname below root.`);
  return { pathname, key: inspected.decoded };
}

/**
 * Compare a pathname supplied by Astro in either its encoded public spelling
 * or its already-decoded request spelling with an exact configured pathname.
 *
 * @param {unknown} candidate
 * @param {unknown} configured
 * @returns {boolean}
 */
export function matchesExactPathname(candidate, configured) {
  if (typeof candidate !== 'string') return false;
  try {
    const identity = exactPathnameIdentity(configured);
    return candidate === identity.pathname || candidate === identity.key;
  } catch {
    return false;
  }
}
