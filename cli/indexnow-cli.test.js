import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { serializeIndexNowQueue } from '../src/build/indexnow-state.js';
import { writePrivateFile } from './indexnow-io.js';

const BIN = resolve('bin/astro-aeo.js');
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('indexnow CLI dispatch', () => {
  test('submits an empty queue without resolving credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-cli-'));
    roots.push(root);
    const queue = join(root, 'pending-v1.json');
    writePrivateFile(queue, serializeIndexNowQueue({ version: 1, origins: [] }));
    const result = spawnSync(process.execPath, [BIN, 'indexnow', 'submit', queue], {
      cwd: root,
      encoding: 'utf8',
      env: {},
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 submitted, 0 pending');
    expect(result.stderr).toBe('');
  });

  test('uses exit 2 for invalid invocation', () => {
    const result = spawnSync(process.execPath, [BIN, 'indexnow', 'prepare', '--source', 'unsafe'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--source must be cache or config');
  });
});
