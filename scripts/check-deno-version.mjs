import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const DENO_VERSION = readFileSync(new URL('../.tool-versions', import.meta.url), 'utf8')
  .match(/^deno (\d+\.\d+\.\d+)$/m)?.[1];
if (!DENO_VERSION) throw new Error('The Deno runtime must have an exact .tool-versions pin.');

export function checkDenoVersion() {
  const result = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  const actual = result.stdout?.match(/^deno (\S+)/)?.[1];
  if (result.status !== 0 || actual !== DENO_VERSION) {
    throw new Error(`Deno local contract requires ${DENO_VERSION}; received ${actual ?? 'unavailable'}.`);
  }
  return actual;
}
