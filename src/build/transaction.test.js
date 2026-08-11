import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { commitFileTransaction } from './transaction.js';

describe('commitFileTransaction', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aeo-transaction-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('stages every write before touching an existing destination', () => {
    const existing = join(root, 'existing.txt');
    writeFileSync(existing, 'original');

    expect(() =>
      commitFileTransaction([
        { kind: 'write', path: existing, contents: 'replacement' },
        { kind: 'write', path: join(root, 'missing.txt'), copyFrom: join(root, 'absent') },
      ]),
    ).toThrow();

    expect(readFileSync(existing, 'utf8')).toBe('original');
    expect(existsSync(join(root, 'missing.txt'))).toBe(false);
  });

  test('rolls a stale deletion back when a later operation fails', () => {
    const stale = join(root, 'stale.txt');
    const output = join(root, 'output.txt');
    writeFileSync(stale, 'stale');

    expect(() =>
      commitFileTransaction(
        [
          { kind: 'delete', path: stale },
          { kind: 'write', path: output, contents: 'new' },
        ],
        {
          beforeApply(_operation, index) {
            if (index === 1) throw new Error('stop');
          },
        },
      ),
    ).toThrow('stop');

    expect(readFileSync(stale, 'utf8')).toBe('stale');
    expect(existsSync(output)).toBe(false);
  });

  test('rejects duplicate destinations before staging', () => {
    const path = join(root, 'same.txt');
    expect(() =>
      commitFileTransaction([
        { kind: 'write', path, contents: 'one' },
        { kind: 'write', path, contents: 'two' },
      ]),
    ).toThrow(/duplicate destination/);
    expect(existsSync(path)).toBe(false);
  });

  test('honors an explicit mode when replacing an existing private file', () => {
    const path = join(root, 'manifest.json');
    writeFileSync(path, '{}');
    chmodSync(path, 0o644);

    commitFileTransaction([{ kind: 'write', path, contents: '{}\n', mode: 0o600 }]);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
