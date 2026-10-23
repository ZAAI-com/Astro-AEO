import { afterEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePrivateLock, inspectPrivateLock, readPrivateLock } from './private-lock.js';

vi.mock('node:fs', { spy: true });
vi.mock('node:os', { spy: true });
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });

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
  test('releases its own lock after the local hostname changes', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    vi.spyOn(os, 'hostname').mockReturnValue('original-host');
    const release = acquirePrivateLock(path, MESSAGES);
    vi.mocked(os.hostname).mockReturnValue('changed-host');
    release();
    expect(existsSync(path)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });

  test('release is idempotent and never removes a replacement lock', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const release = acquirePrivateLock(path, MESSAGES);
    const replacement = JSON.stringify({ ...readPrivateLock(path), nonce: 'replacement-nonce' });
    writeFileSync(path, replacement);
    release();
    release();
    expect(readFileSync(path, 'utf8')).toBe(replacement);
    rmSync(directory, { recursive: true, force: true });
  });

  test('never reclaims a foreign-host lock even when its PID is dead', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const before = seedStaleLock(path);
    vi.spyOn(os, 'hostname').mockReturnValue('different-host');
    expect(() => acquirePrivateLock(path, MESSAGES)).toThrow(MESSAGES.busy);
    expect(readFileSync(path, 'utf8')).toBe(before);
    rmSync(directory, { recursive: true, force: true });
  });

  test('reports a failed removal without deleting another lock or throwing', async () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const onReleaseError = vi.fn();
    const release = acquirePrivateLock(path, MESSAGES, onReleaseError);
    const original = (await vi.importActual('node:fs')).rmSync;
    const error = Object.assign(new Error('private filesystem details'), { code: 'EACCES' });
    vi.spyOn(fs, 'rmSync').mockImplementation((entry, options) => {
      if (entry === path) throw error;
      return original(entry, options);
    });
    expect(() => release()).not.toThrow();
    expect(onReleaseError).toHaveBeenCalledExactlyOnceWith(error);
    expect(existsSync(path)).toBe(true);
    original(directory, { recursive: true, force: true });
  });

  test('preserves a filesystem failure while creating the reclaim mutex', async () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    seedStaleLock(path);
    const original = (await vi.importActual('node:fs')).openSync;
    const error = Object.assign(new Error('private path must not enter diagnostics'), { code: 'EACCES' });
    vi.spyOn(fs, 'openSync').mockImplementation((target, ...args) => {
      if (target === `${path}.reclaim`) throw error;
      return original(target, ...args);
    });
    expect(() => acquirePrivateLock(path, MESSAGES)).toThrow(error);
    expect(readPrivateLock(path)?.nonce).toBe('stale-nonce-0001');
    rmSync(directory, { recursive: true, force: true });
  });

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
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { acquirePrivateLock } from ${JSON.stringify(fileURLToPath(new URL('./private-lock.js', import.meta.url)))};
const [, , lockPath, barrierPath, resultPath] = process.argv;
while (!existsSync(barrierPath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
try {
  const release = acquirePrivateLock(lockPath, { busy: 'busy', unsafe: 'unsafe', changed: 'changed' });
  try {
    writeFileSync(resultPath, 'winner');
    // Keep the winner alive and locked until every contender has attempted acquisition.
    // A fixed delay permits late-starting children to acquire the released lock legally.
    const deadline = Date.now() + 10_000;
    while (readdirSync(dirname(resultPath)).length < 8) {
      if (Date.now() >= deadline) throw new Error('contender did not record an attempt');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  } finally {
    release();
  }
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

describe('inspectPrivateLock', () => {
  test('reports only booleans for an active lock and changes nothing', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const release = acquirePrivateLock(path, MESSAGES);
    const before = readFileSync(path, 'utf8');
    expect(inspectPrivateLock(path)).toEqual({
      present: true, mutexPresent: false, record: { pidAlive: true, sameHost: true },
    });
    expect(readFileSync(path, 'utf8')).toBe(before);
    release();
    expect(inspectPrivateLock(path)).toEqual({ present: false, mutexPresent: false, record: null });
    rmSync(directory, { recursive: true, force: true });
  });

  test('reports a dead owner and retained mutex without reclaiming either', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const before = seedStaleLock(path);
    writeFileSync(`${path}.reclaim`, '');
    expect(inspectPrivateLock(path)).toEqual({
      present: true, mutexPresent: true, record: { pidAlive: false, sameHost: true },
    });
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(existsSync(`${path}.reclaim`)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });

  test('reports foreign hosts without exposing their name', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    writeFileSync(path, JSON.stringify({ version: 1, hostname: 'private-foreign-host', pid: process.pid, nonce: 'foreign-nonce-01' }));
    expect(inspectPrivateLock(path)).toEqual({
      present: true, mutexPresent: false, record: { pidAlive: true, sameHost: false },
    });
    rmSync(directory, { recursive: true, force: true });
  });

  test('invalid records and symlinks are present but never read as records', () => {
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    writeFileSync(path, 'not a lock');
    expect(inspectPrivateLock(path)).toEqual({ present: true, mutexPresent: false, record: null });
    const link = join(directory, 'link');
    fs.symlinkSync(path, link);
    const read = vi.spyOn(fs, 'readFileSync');
    read.mockClear();
    expect(inspectPrivateLock(link)).toEqual({ present: true, mutexPresent: false, record: null });
    expect(read).not.toHaveBeenCalled();
    rmSync(directory, { recursive: true, force: true });
  });

  test('unreadable entries never make inspection throw', () => {
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw Object.assign(new Error('private'), { code: 'EACCES' }); });
    expect(inspectPrivateLock('/unreadable')).toEqual({ present: false, mutexPresent: false, record: null });
  });

  test('a symlink swapped in after lstat is not followed', async () => {
    if (process.platform === 'win32') return;
    const directory = tempDirectory();
    const path = join(directory, 'lock');
    const target = join(directory, 'private');
    writeFileSync(path, '{}');
    writeFileSync(target, 'must not be read');
    const actual = await vi.importActual('node:fs');
    vi.spyOn(fs, 'openSync').mockImplementationOnce((entry, ...args) => {
      rmSync(path);
      fs.symlinkSync(target, path);
      return actual.openSync(entry, ...args);
    });
    const read = vi.spyOn(fs, 'readFileSync');
    read.mockClear();
    expect(inspectPrivateLock(path)).toEqual({ present: true, mutexPresent: false, record: null });
    expect(read).not.toHaveBeenCalled();
    rmSync(directory, { recursive: true, force: true });
  });
});
