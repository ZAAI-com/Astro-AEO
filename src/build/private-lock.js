// @ts-check
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';

/**
 * Hold an exclusive private-state lock. The claim is an atomic `linkSync` from
 * a private temporary. A stale lock (same host, proven-dead PID) can only be
 * reclaimed inside a dedicated `${path}.reclaim` mutex created with
 * `O_CREAT|O_EXCL`, so two contenders can never both validate the same inode
 * and unlink each other's replacement lock. Only a hard kill inside the
 * microsecond-wide critical section leaves the mutex behind, which blocks
 * future reclamation while ordinary claim and release keep working: the
 * fail-closed posture the callers document.
 *
 * @param {string} path
 * @param {{ busy: string; unsafe: string; changed: string }} messages
 * @returns {() => void} release
 */
export function acquirePrivateLock(path, messages) {
  const nonce = randomUUID();
  const record = { version: 1, hostname: hostname(), pid: process.pid, nonce };
  const temporary = `${path}.${process.pid}.${nonce}.tmp`;
  const mutex = `${path}.reclaim`;
  const writeTemporary = () => {
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { writeFileSync(fd, `${JSON.stringify(record)}\n`); }
    finally { closeSync(fd); }
  };
  const claim = () => {
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'EEXIST') throw error;
      return false;
    }
  };

  writeTemporary();
  try {
    if (!claim()) reclaimStaleLock(path, mutex, claim, messages);
  } finally {
    rmSync(temporary, { force: true });
  }

  let held = true;
  return () => {
    if (!held) return;
    held = false;
    try {
      const current = readPrivateLock(path);
      if (current?.nonce === nonce && current.pid === process.pid && current.hostname === hostname()) {
        const stat = lstatSync(path);
        if (stat.isFile() && !stat.isSymbolicLink()) rmSync(path, { force: true });
      }
    } catch {
      // A retained or replaced lock fails closed for the next session.
    }
  };
}

/**
 * Reclaim a validated stale lock under the reclaim mutex. Every validation
 * failure rethrows and leaves the stale lock in place.
 *
 * @param {string} path
 * @param {string} mutex
 * @param {() => boolean} claim
 * @param {{ busy: string; unsafe: string; changed: string }} messages
 */
function reclaimStaleLock(path, mutex, claim, messages) {
  let fd;
  try {
    fd = openSync(mutex, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch {
    // Another contender owns the critical section; fail closed.
    throw new Error(messages.busy);
  }
  try {
    const prior = readPrivateLock(path);
    if (!prior || prior.hostname !== hostname() || processExists(prior.pid)) {
      throw new Error(messages.busy);
    }
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error(messages.unsafe);
    const confirmed = readPrivateLock(path);
    const after = lstatSync(path);
    if (
      !confirmed ||
      confirmed.nonce !== prior.nonce ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    ) {
      throw new Error(messages.changed);
    }
    rmSync(path, { force: true });
    if (!claim()) throw new Error(messages.busy);
  } finally {
    try { closeSync(fd); } catch {}
    rmSync(mutex, { force: true });
  }
}

/**
 * Load only a strictly validated, regular non-symlink lock record.
 * @param {string} path
 */
export function readPrivateLock(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value?.version === 1 &&
      typeof value.hostname === 'string' && value.hostname &&
      Number.isSafeInteger(value.pid) && value.pid > 0 &&
      typeof value.nonce === 'string' && /^[A-Za-z0-9-]{8,128}$/u.test(value.nonce) &&
      Object.keys(value).every((key) => ['version', 'hostname', 'pid', 'nonce'].includes(key))
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 */
export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {any} */ (error)?.code !== 'ESRCH';
  }
}
