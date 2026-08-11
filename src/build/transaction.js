// @ts-check
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSafeOutputPath } from './ownership.js';

/**
 * @typedef {{ kind: 'write'; path: string; contents?: string | Buffer; copyFrom?: string; mode?: number; confineTo?: string } | { kind: 'delete'; path: string; confineTo?: string }} FileOperation
 */

/**
 * Commit a set of files with validation atomicity and caught-error rollback.
 * Every write is fully staged before a destination is moved. Individual moves
 * are atomic; a process kill between moves is outside this guarantee.
 *
 * @param {FileOperation[]} operations
 * @param {{ beforeApply?: (operation: FileOperation, index: number) => void; transactionId?: string }} [options]
 */
export function commitFileTransaction(operations, options = {}) {
  const normalizedOperations = operations.map((operation) => {
    if (typeof operation.path !== 'string' || operation.path.length === 0) {
      throw new Error('astro-aeo: transaction destinations must be non-empty paths');
    }
    return {
      ...operation,
      path: resolve(operation.path),
      ...(operation.confineTo ? { confineTo: resolve(operation.confineTo) } : {}),
    };
  });
  const seen = new Set();
  for (let index = 0; index < normalizedOperations.length; index++) {
    const operation = normalizedOperations[index];
    if (seen.has(operation.path)) {
      throw new Error(`astro-aeo: transaction contains duplicate destination ${operation.path}`);
    }
    seen.add(operation.path);
    assertSafeAncestry(operation);
    for (let prior = 0; prior < index; prior++) {
      const previous = normalizedOperations[prior];
      if (isDescendantPath(previous.path, operation.path) || isDescendantPath(operation.path, previous.path)) {
        throw new Error(
          `astro-aeo: transaction contains overlapping destinations ${previous.path} and ${operation.path}`,
        );
      }
    }
  }

  const id = options.transactionId ?? randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(id)) {
    throw new Error('astro-aeo: transaction id must be a safe filename token');
  }
  /** @type {{ operation: FileOperation; temp?: string; backup: string; existed: boolean; mode?: number; backedUp: boolean; installed: boolean }[]} */
  const entries = normalizedOperations.map((operation) => {
    const stat = entryStat(operation.path);
    const existed = stat !== null;
    let mode;
    if (stat) {
      if (stat.isDirectory()) {
        throw new Error(`astro-aeo: artifact destination is a directory: ${operation.path}`);
      }
      if (!stat.isSymbolicLink()) mode = stat.mode & 0o777;
    }
    const stem = `.${basename(operation.path)}.astro-aeo-${id}`;
    return {
      operation,
      ...(operation.kind === 'write' ? { temp: join(dirname(operation.path), `${stem}.tmp`) } : {}),
      backup: join(dirname(operation.path), `${stem}.bak`),
      existed,
      mode,
      backedUp: false,
      installed: false,
    };
  });

  // Detect every retained recovery or staging file before creating directories
  // or staging bytes for any operation in the transaction.
  for (const entry of entries) {
    if (entryExists(entry.backup)) {
      throw new Error(`astro-aeo: transaction backup already exists: ${entry.backup}`);
    }
    if (entry.temp && entryExists(entry.temp)) {
      throw new Error(`astro-aeo: transaction temporary file already exists: ${entry.temp}`);
    }
  }

  try {
    // Stage every byte before touching any destination.
    for (const entry of entries) {
      const { operation } = entry;
      assertSafeAncestry(operation);
      mkdirSync(dirname(operation.path), { recursive: true });
      assertSafeAncestry(operation);
      if (operation.kind === 'delete') continue;
      const contents = operation.copyFrom
        ? readFileSync(operation.copyFrom)
        : operation.contents ?? '';
      writeFileSync(/** @type {string} */ (entry.temp), contents, {
        flag: 'wx',
        mode: operation.mode ?? entry.mode ?? 0o644,
      });
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      options.beforeApply?.(entry.operation, index);
      assertSafeAncestry(entry.operation);
      if (entry.existed) {
        if (entryExists(entry.backup)) {
          throw new Error(`astro-aeo: transaction backup already exists: ${entry.backup}`);
        }
        renameSync(entry.operation.path, entry.backup);
        entry.backedUp = true;
      } else if (entryExists(entry.operation.path)) {
        throw new Error(
          `astro-aeo: transaction destination appeared during commit: ${entry.operation.path}`,
        );
      }
      if (entry.operation.kind === 'write') {
        assertSafeAncestry(entry.operation);
        if (entryExists(entry.operation.path)) {
          throw new Error(
            `astro-aeo: transaction destination appeared during commit: ${entry.operation.path}`,
          );
        }
        renameSync(/** @type {string} */ (entry.temp), entry.operation.path);
        entry.installed = true;
        const finalMode = entry.operation.mode ?? entry.mode;
        if (finalMode !== undefined) chmodSync(entry.operation.path, finalMode);
      }
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      try {
        assertSafeAncestry(entry.operation);
        if (entry.installed && entryExists(entry.operation.path)) {
          rmSync(entry.operation.path, { force: true });
        }
        if (entry.backedUp && entryExists(entry.backup) && !entryExists(entry.operation.path)) {
          renameSync(entry.backup, entry.operation.path);
          entry.backedUp = false;
        }
        if (entry.temp && entryExists(entry.temp)) rmSync(entry.temp, { force: true });
      } catch {
        // Preserve the original commit error. A subsequent build will still see
        // the backup rather than silently treating it as owned output.
      }
    }
    throw error;
  }

  for (const entry of entries) {
    try {
      assertSafeAncestry(entry.operation);
      if (entry.temp && entryExists(entry.temp)) rmSync(entry.temp, { force: true });
      if (entry.backedUp && entryExists(entry.backup)) rmSync(entry.backup, { force: true });
    } catch {
      // Cleanup cannot change a successful commit into a reported rollback.
      // A uniquely named backup is safer to retain than deleting a committed
      // destination in a second recovery attempt.
    }
  }
}

/** @param {FileOperation} operation */
function assertSafeAncestry(operation) {
  if (operation.confineTo && !isSafeOutputPath(operation.confineTo, operation.path)) {
    throw new Error(`astro-aeo: transaction destination ancestry is unsafe: ${operation.path}`);
  }
}

/** @param {string} parent @param {string} candidate */
function isDescendantPath(parent, candidate) {
  const value = relative(parent, candidate);
  return Boolean(value) && !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`);
}

/** @param {string} path @returns {import('node:fs').Stats | null} */
function entryStat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} path */
function entryExists(path) {
  return entryStat(path) !== null;
}
