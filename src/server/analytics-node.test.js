import { test, expect } from 'vitest';
import { mkdtemp, readFile, stat, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlSink } from './analytics-node.js';

test('JSONL serializes concurrent appends privately without truncation or initialization writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeo-events-'));
  try {
    const sink = createJsonlSink(undefined, root); await expect(stat(join(root, '.astro'))).rejects.toThrow();
    await Promise.all(Array.from({ length: 30 }, (_, id) => sink({ version: 1, id })));
    const path = join(root, '.astro/aeo-analytics/events-v1.jsonl');
    expect((await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse)).toEqual(Array.from({ length: 30 }, (_, id) => ({ version: 1, id })));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(() => createJsonlSink('../outside.jsonl', root)).toThrow('inside the project');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('JSONL refuses symlink destinations and ancestors, preserves originals, and recovers its queue after failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeo-events-'));
  try {
    await mkdir(join(root, 'logs')); await writeFile(join(root, 'original'), 'untouched'); await symlink(join(root, 'original'), join(root, 'logs/events'));
    const sink = createJsonlSink('logs/events', root); await expect(sink({})).rejects.toThrow(); expect(await readFile(join(root, 'original'), 'utf8')).toBe('untouched');
    await rm(join(root, 'logs/events')); await sink({ version: 1 }); expect(JSON.parse(await readFile(join(root, 'logs/events'), 'utf8'))).toEqual({ version: 1 });
    await symlink(join(root, 'logs'), join(root, 'alias')); await expect(createJsonlSink('alias/events', root)({})).rejects.toThrow('Unsafe');
  } finally { await rm(root, { recursive: true, force: true }); }
});
