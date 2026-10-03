// A separate process keeps framework startup and peak RSS measurable per build.
import { build } from 'astro';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [project, destination] = process.argv.slice(2);
const start = performance.now();
await build({ root: pathToFileURL(`${project}/`), logLevel: 'silent' });
const durationMs = performance.now() - start;
async function bytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Benchmark outputs must not contain symlinks.');
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await bytes(path) : (await stat(path)).size;
  }
  return total;
}
let trace = null;
try { trace = JSON.parse(await readFile(join(project, '.astro/aeo-cache/trace-v1.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const work = {};
for (const event of trace?.stages ?? []) {
  const key = `${event.stage}:${event.outcome}`;
  work[key] = (work[key] ?? 0) + 1;
}
await writeFile(destination, JSON.stringify({ durationMs, peakRssBytes: process.resourceUsage().maxRSS * 1024,
  heapUsedBytes: process.memoryUsage().heapUsed, outputBytes: await bytes(join(project, 'dist')),
  work, buildDigest: trace?.buildDigest ?? null }), { mode: 0o600 });
