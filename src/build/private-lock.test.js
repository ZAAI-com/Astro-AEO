import { describe, expect, test } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePrivateLock, readPrivateLock } from './private-lock.js';

const MESSAGES = { busy: 'locked', unsafe: 'unsafe', changed: 'changed' };

/** A provably dead PID: spawn a node that exits immediately and reuse its pid. */
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', '']);
  expect(child.status).toBe(0);
  return child.pid;
}

function seedStaleLock(path, pid = deadPid()) {
  writeFileSync(path, `${JSON.stringify({ version: 1, hostname: hostname(), pid, nonce: 'stale-nonce-0001' })}\n`);
  return readFileSync(path, 'utf8');
}

function tempDirectory() {
  return mkdtempSync(join(tmpdir(), 'aeo-private-lock-'));
}

describe('acquirePrivateLock', () => {
  test('a retained reclaim mutex fails closed and leaves the stale lock byte-unchanged', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const stale = seedStaleLock(path);
    writeFileSync(`${path}.reclaim`, '');

    expect(() => acquirePrivateLock(path, MESSAGES)).toThrow(MESSAGES.busy);
    expect(readFileSync(path, 'utf8')).toBe(stale);
    expect(existsSync(`${path}.reclaim`)).toBe(true);

    rmSync(directory, { recursive: true, force: true });
  });

  test('reclaims a stale lock and leaves no mutex behind', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    seedStaleLock(path);

    const release = acquirePrivateLock(path, MESSAGES);
    const held = readPrivateLock(path);
    expect(held?.pid).toBe(process.pid);
    expect(held?.nonce).not.toBe('stale-nonce-0001');
    expect(existsSync(`${path}.reclaim`)).toBe(false);

    release();
    expect(readPrivateLock(path)).toBeNull();

    rmSync(directory, { recursive: true, force: true });
  });

  test('exactly one of eight simultaneous contenders wins', async () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const barrier = join(directory, 'barrier');
    const results = join(directory, 'results');
    mkdirSync(results);
    const script = join(directory, 'contender.mjs');
    writeFileSync(script, `
import { existsSync, writeFileSync } from 'node:fs';
import { acquirePrivateLock } from ${JSON.stringify(fileURLToPath(new URL('./private-lock.js', import.meta.url)))};
const [, , lockPath, barrierPath, resultPath] = process.argv;
while (!existsSync(barrierPath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
try {
  const release = acquirePrivateLock(lockPath, { busy: 'busy', unsafe: 'unsafe', changed: 'changed' });
  writeFileSync(resultPath, 'winner');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  release();
} catch {
  writeFileSync(resultPath, 'loser');
}
`);

    const children = Array.from({ length: 8 }, () =>
      spawn(process.execPath, [script, path, barrier, join(results, `r-${Math.random().toString(36).slice(2)}`)]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(barrier, '');
    await Promise.all(children.map((child) => new Promise((resolve, reject) => {
      child.on('exit', resolve);
      child.on('error', reject);
    })));

    const outcomes = readdirSync(results).map((name) => readFileSync(join(results, name), 'utf8'));
    expect(outcomes).toHaveLength(8);
    expect(outcomes.filter((outcome) => outcome === 'winner')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'loser')).toHaveLength(7);
    expect(readPrivateLock(path)).toBeNull();
    expect(existsSync(`${path}.reclaim`)).toBe(false);

    rmSync(directory, { recursive: true, force: true });
  }, 20_000);
});
