// A separate process keeps peak RSS measurable per build. Timing starts after the
// Astro import, so module loading is excluded (see benchmarks/README.md).
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
// Why the cache missed (read-only, key-missing, blob-invalid, ...) and any
// processing-cache diagnostic, so an intermittent cold run can be explained.
let diagnosticCodes = [];
let diagnosticMessages = [];
try {
  const manifest = JSON.parse(await readFile(join(project, '.astro/aeo-cache/diagnostics-v1.json'), 'utf8'));
  diagnosticCodes = [...new Set((manifest?.diagnostics ?? []).map((entry) => entry.code))].sort();
  diagnosticMessages = [...new Set((manifest?.diagnostics ?? [])
    .filter((entry) => entry.code.startsWith('processing-cache-')).map((entry) => entry.message))].sort();
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(destination, JSON.stringify({ durationMs, peakRssBytes: process.resourceUsage().maxRSS * 1024,
  heapUsedBytes: process.memoryUsage().heapUsed, outputBytes: await bytes(join(project, 'dist')),
  work, buildDigest: trace?.buildDigest ?? null, cacheReasons: trace?.cacheReasons ?? null,
  diagnosticCodes, diagnosticMessages }), { mode: 0o600 });
