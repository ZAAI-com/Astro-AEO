// @ts-check
import {
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';

/**
 * Read tool-owned JSON state. When a project root is supplied the whole
 * directory chain must stay canonically inside it, so a symlinked `.astro` or
 * `aeo-cache` cannot make the CLI consume a queue, acknowledgment, or prepare
 * input from outside the project and act on it.
 * @param {string} path
 * @param {string} [root]
 */
export function readJsonFile(path, root) {
  if (root !== undefined) assertCanonicallyInsideRoot(dirname(path), root);
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { throw new IndexNowInvocationError(`cannot read ${path}: ${errorMessage(error)}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new IndexNowInvocationError(`cannot read ${path}: IndexNow state must be a regular non-symlink file`);
  }
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) { throw new IndexNowInvocationError(`cannot read ${path}: ${errorMessage(error)}`); }
  try { return JSON.parse(raw); }
  catch { throw new IndexNowInvocationError(`cannot parse ${path} as JSON`); }
}

/**
 * Atomic private write with a sibling temporary file. No secret-derived value
 * is included in either filename. Parent directories are created without changing
 * their mode. When the target is lexically under the supplied project root, the
 * created directory must also stay canonically inside it, so a symlinked
 * `.astro` or `aeo-cache` cannot redirect private state outside the project.
 * @param {string} path
 * @param {string} contents
 * @param {string} [root]
 */
export function writePrivateFile(path, contents, root) {
  const directory = dirname(path);
  // Validate the deepest directory that already exists before creating anything.
  // `mkdirSync` with `recursive` follows a symlinked ancestor, so checking only
  // afterwards still lets a redirected chain materialize outside the project.
  if (root !== undefined) {
    assertCanonicallyInsideRoot(nearestExistingAncestor(directory), root);
  }
  mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new IndexNowInvocationError('cannot write IndexNow state through an unsafe directory');
  }
  if (root !== undefined) {
    assertCanonicallyInsideRoot(directory, root);
  }
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    throw new IndexNowInvocationError(`cannot write ${path}: ${errorMessage(error)}`);
  }
}

/**
 * The closest ancestor of `directory` that exists on disk, so confinement can be
 * checked before any component is created.
 * @param {string} directory
 */
function nearestExistingAncestor(directory) {
  let current = resolve(directory);
  for (;;) {
    try {
      lstatSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/** @param {string} directory @param {string} root */
function assertCanonicallyInsideRoot(directory, root) {
  const rootPath = resolve(root);
  if (directory !== rootPath && !directory.startsWith(`${rootPath}${sep}`)) return;
  let rootReal;
  let directoryReal;
  try {
    rootReal = realpathSync(rootPath);
    directoryReal = realpathSync(directory);
  } catch {
    throw new IndexNowInvocationError('cannot write IndexNow state through an unsafe directory');
  }
  if (directoryReal !== rootReal && !directoryReal.startsWith(`${rootReal}${sep}`)) {
    throw new IndexNowInvocationError('cannot write IndexNow state through an unsafe directory');
  }
}

export class IndexNowInvocationError extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IndexNowInvocationError';
  }
}

export class IndexNowRemoteError extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IndexNowRemoteError';
  }
}

/** @param {unknown} error */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
