import { spawn } from 'node:child_process';

const POSIX_PROCESS_GROUPS = process.platform !== 'win32';
const stoppedTrees = new WeakSet();

/**
 * Start a long-lived child in its own process group where the platform supports it.
 * Adapter preview commands spawn their actual runtime as a descendant, so stopping
 * only the direct child can leave workerd alive and writing into the fixture.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 */
export function spawnProcessTree(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    detached: POSIX_PROCESS_GROUPS,
  });
}

/**
 * Stop the complete process tree and wait until it can no longer touch build output.
 *
 * @param {import('node:child_process').ChildProcess | undefined} child
 * @param {{ gracefulTimeoutMs?: number; killTimeoutMs?: number }} [options]
 */
export async function stopProcessTree(child, options = {}) {
  if (!child?.pid || stoppedTrees.has(child)) return;
  stoppedTrees.add(child);

  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 2_000;
  const killTimeoutMs = options.killTimeoutMs ?? 2_000;

  signalTree(child, 'SIGTERM');
  await waitForChildExit(child, gracefulTimeoutMs);

  // The launcher can exit before descendants such as workerd have released
  // files. Give the whole group a brief graceful window, then signal it again
  // even if the direct child has already gone away.
  await new Promise((resolve) => setTimeout(resolve, 50));

  signalTree(child, 'SIGKILL');
  await waitForChildExit(child, killTimeoutMs);
  await new Promise((resolve) => setTimeout(resolve, 25));
}

/** @param {import('node:child_process').ChildProcess} child @param {NodeJS.Signals} signal */
function signalTree(child, signal) {
  try {
    if (POSIX_PROCESS_GROUPS) process.kill(-child.pid, signal);
    else if (child.exitCode === null) child.kill(signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 */
async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** @param {unknown} error */
function isMissingProcess(error) {
  return Boolean(error) && /** @type {{ code?: string }} */ (error).code === 'ESRCH';
}
