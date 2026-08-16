import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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

  test('rejects lexically different paths to the same destination', () => {
    mkdirSync(join(root, 'nested'));
    const path = join(root, 'same.txt');
    writeFileSync(path, 'original');

    expect(() =>
      commitFileTransaction([
        { kind: 'write', path, contents: 'replacement' },
        { kind: 'delete', path: `${root}/nested/../same.txt` },
      ]),
    ).toThrow(/duplicate destination/);

    expect(readFileSync(path, 'utf8')).toBe('original');
  });

  test('rejects ancestor and descendant destinations before staging', () => {
    const parent = join(root, 'nested');
    const child = join(parent, 'child.txt');

    expect(() =>
      commitFileTransaction([
        { kind: 'write', path: parent, contents: 'parent' },
        { kind: 'write', path: child, contents: 'child' },
      ]),
    ).toThrow(/overlapping destinations/);

    expect(existsSync(parent)).toBe(false);
  });

  test('uses collision-resistant staging names and never overwrites a backup', () => {
    const path = join(root, 'same.txt');
    writeFileSync(path, 'original');
    let plantedBackup = '';

    expect(() =>
      commitFileTransaction(
        [{ kind: 'write', path, contents: 'replacement' }],
        {
          beforeApply() {
            const temp = readdirSync(root).find((name) => name.endsWith('.tmp'));
            expect(temp).toMatch(
              /^\.same\.txt\.astro-aeo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/,
            );
            plantedBackup = join(root, /** @type {string} */ (temp).replace(/\.tmp$/, '.bak'));
            writeFileSync(plantedBackup, 'retained recovery copy');
          },
        },
      ),
    ).toThrow(/backup already exists/);

    expect(readFileSync(path, 'utf8')).toBe('original');
    expect(readFileSync(plantedBackup, 'utf8')).toBe('retained recovery copy');
    expect(readdirSync(root).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  test('fails before staging when a retained backup already exists', () => {
    const path = join(root, 'same.txt');
    const id = 'retained-backup';
    const backup = join(root, `.same.txt.astro-aeo-${id}.bak`);
    writeFileSync(path, 'original');
    writeFileSync(backup, 'recovery copy');

    expect(() =>
      commitFileTransaction(
        [{ kind: 'write', path, contents: 'replacement' }],
        { transactionId: id },
      ),
    ).toThrow(/backup already exists/);

    expect(readFileSync(path, 'utf8')).toBe('original');
    expect(readFileSync(backup, 'utf8')).toBe('recovery copy');
    expect(readdirSync(root).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  test.each([
    ['backup', 'bak'],
    ['temporary file', 'tmp'],
  ])('treats a dangling transaction %s as an existing entry', (label, suffix) => {
    const path = join(root, 'same.txt');
    const id = 'dangling-entry';
    const retained = join(root, `.same.txt.astro-aeo-${id}.${suffix}`);
    symlinkSync('missing-recovery-target', retained);
    expect(existsSync(retained)).toBe(false);

    expect(() =>
      commitFileTransaction(
        [{ kind: 'write', path, contents: 'replacement' }],
        { transactionId: id },
      ),
    ).toThrow(new RegExp(`${label} already exists`));

    expect(lstatSync(retained).isSymbolicLink()).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test('restores a dangling destination symlink when a later operation fails', () => {
    const path = join(root, 'dangling.txt');
    const later = join(root, 'later.txt');
    symlinkSync('missing-destination', path);

    expect(() =>
      commitFileTransaction(
        [
          { kind: 'write', path, contents: 'replacement' },
          { kind: 'write', path: later, contents: 'later' },
        ],
        {
          beforeApply(_operation, index) {
            if (index === 1) throw new Error('stop');
          },
        },
      ),
    ).toThrow('stop');

    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path)).toBe('missing-destination');
    expect(existsSync(later)).toBe(false);
  });

  test('rejects an ancestor replaced by a symlink after staging', () => {
    const ancestor = join(root, 'nested');
    const outside = join(root, 'outside');
    const path = join(ancestor, 'file.txt');
    mkdirSync(outside);

    expect(() =>
      commitFileTransaction(
        [{ kind: 'write', path, contents: 'generated', confineTo: root }],
        {
          beforeApply() {
            rmSync(ancestor, { recursive: true, force: true });
            symlinkSync(outside, ancestor, 'dir');
          },
        },
      ),
    ).toThrow(/destination ancestry is unsafe/);

    expect(existsSync(join(outside, 'file.txt'))).toBe(false);
  });

  test('honors an explicit mode when replacing an existing private file', () => {
    const path = join(root, 'manifest.json');
    writeFileSync(path, '{}');
    chmodSync(path, 0o644);

    commitFileTransaction([{ kind: 'write', path, contents: '{}\n', mode: 0o600 }]);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
