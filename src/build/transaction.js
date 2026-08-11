// @ts-check
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

let transactionCounter = 0;

/**
 * @typedef {{ kind: 'write'; path: string; contents?: string | Buffer; copyFrom?: string; mode?: number } | { kind: 'delete'; path: string }} FileOperation
 */

/**
 * Commit a set of files with validation atomicity and caught-error rollback.
 * Every write is fully staged before a destination is moved. Individual moves
 * are atomic; a process kill between moves is outside this guarantee.
 *
 * @param {FileOperation[]} operations
 * @param {{ beforeApply?: (operation: FileOperation, index: number) => void }} [options]
 */
export function commitFileTransaction(operations, options = {}) {
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.path)) {
      throw new Error(`astro-aeo: transaction contains duplicate destination ${operation.path}`);
    }
    seen.add(operation.path);
  }

  const id = `${process.pid}-${++transactionCounter}`;
  /** @type {{ operation: FileOperation; temp?: string; backup: string; existed: boolean; mode?: number; applied: boolean }[]} */
  const entries = [];

  try {
    // Stage every byte before touching any destination.
    for (const operation of operations) {
      mkdirSync(dirname(operation.path), { recursive: true });
      const existed = existsSync(operation.path);
      let mode;
      if (existed) {
        const stat = lstatSync(operation.path);
        if (stat.isDirectory()) {
          throw new Error(`astro-aeo: artifact destination is a directory: ${operation.path}`);
        }
        mode = stat.mode & 0o777;
      }
      const stem = `.${basename(operation.path)}.astro-aeo-${id}`;
      const backup = join(dirname(operation.path), `${stem}.bak`);
      if (operation.kind === 'delete') {
        entries.push({ operation, backup, existed, mode, applied: false });
        continue;
      }
      const temp = join(dirname(operation.path), `${stem}.tmp`);
      const contents = operation.copyFrom
        ? readFileSync(operation.copyFrom)
        : operation.contents ?? '';
      writeFileSync(temp, contents, { flag: 'wx', mode: operation.mode ?? mode ?? 0o644 });
      entries.push({ operation, temp, backup, existed, mode, applied: false });
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      options.beforeApply?.(entry.operation, index);
      if (entry.existed) renameSync(entry.operation.path, entry.backup);
      if (entry.operation.kind === 'write') {
        renameSync(/** @type {string} */ (entry.temp), entry.operation.path);
        const finalMode = entry.operation.mode ?? entry.mode;
        if (finalMode !== undefined) chmodSync(entry.operation.path, finalMode);
      }
      entry.applied = true;
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.applied && entry.operation.kind === 'write' && existsSync(entry.operation.path)) {
          rmSync(entry.operation.path, { force: true });
        }
        if (existsSync(entry.backup)) renameSync(entry.backup, entry.operation.path);
        if (entry.temp && existsSync(entry.temp)) rmSync(entry.temp, { force: true });
      } catch {
        // Preserve the original commit error. A subsequent build will still see
        // the backup rather than silently treating it as owned output.
      }
    }
    throw error;
  }

  for (const entry of entries) {
    try {
      if (entry.temp && existsSync(entry.temp)) rmSync(entry.temp, { force: true });
      if (existsSync(entry.backup)) rmSync(entry.backup, { force: true });
    } catch {
      // Cleanup cannot change a successful commit into a reported rollback.
      // A uniquely named backup is safer to retain than deleting a committed
      // destination in a second recovery attempt.
    }
  }
}
