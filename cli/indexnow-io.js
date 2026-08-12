// @ts-check
import {
  mkdirSync,
  openSync,
  closeSync,
  chmodSync,
  fsyncSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

/** @param {string} path */
export function readJsonFile(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) { throw new IndexNowInvocationError(`cannot read ${path}: ${errorMessage(error)}`); }
  try { return JSON.parse(raw); }
  catch { throw new IndexNowInvocationError(`cannot parse ${path} as JSON`); }
}

/**
 * Atomic private write with a sibling temporary file. No secret-derived value
 * is included in either filename.
 * @param {string} path
 * @param {string} contents
 */
export function writePrivateFile(path, contents) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new IndexNowInvocationError('cannot write IndexNow state through an unsafe directory');
  }
  try { chmodSync(directory, 0o700); } catch {}
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
