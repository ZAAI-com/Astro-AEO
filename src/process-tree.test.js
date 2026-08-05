import { once } from 'node:events';
import { describe, expect, test } from 'vitest';
import { spawnProcessTree, stopProcessTree } from '../scripts/process-tree.mjs';

describe.skipIf(process.platform === 'win32')('release process cleanup', () => {
  test('stops a descendant after the preview command itself has exited', async () => {
    const leader = spawnProcessTree(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { spawn } from 'node:child_process';
const runtime = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
runtime.unref();
process.stdout.write(String(runtime.pid) + '\\n');`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const [chunk] = await once(leader.stdout, 'data');
    const runtimePid = Number(String(chunk).trim());
    if (leader.exitCode === null) await once(leader, 'exit');

    try {
      expect(processIsAlive(runtimePid)).toBe(true);
      await stopProcessTree(leader);
      expect(processIsAlive(runtimePid)).toBe(false);
    } finally {
      await stopProcessTree(leader);
    }
  });
});

/** @param {number} pid */
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === 'ESRCH') return false;
    throw error;
  }
}
