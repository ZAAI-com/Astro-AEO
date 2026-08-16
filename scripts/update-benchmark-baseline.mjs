#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, process.argv[2] ?? '.astro/aeo-benchmarks/1.2-reference.json');
const output = resolve(root, 'benchmarks/baseline-1.2.json');
const report = JSON.parse(await readFile(input, 'utf8'));

if (!report.environment?.runnerClass) {
  throw new Error('Refusing to update the baseline without ASTRO_AEO_BENCHMARK_RUNNER.');
}
if (report.failures?.length) {
  throw new Error(`Refusing to record a failing benchmark: ${report.failures.join('; ')}`);
}

const { rawSamplesMs: _rawSamples, ...requests } = report.requests ?? {};
const baseline = {
  version: 1,
  recordedAt: String(report.generatedAt).slice(0, 10),
  environment: report.environment,
  package: report.package,
  extraction: report.extraction,
  memory: report.memory,
  corpus: report.corpus,
  requests,
  bundles: {
    node: compactBundle(report.bundles?.node),
    cloudflare: compactBundle(report.bundles?.cloudflare),
  },
  cloudflareStartupMs: report.cloudflareStartupMs,
  notes: [
    'This is a reproducible reference measurement, not a portable performance promise.',
    'Package and bundle byte regressions are compared across release runners; timing and memory comparisons require an equivalent environment.',
    'Request overhead uses 200 paired, interleaved samples per Markdown mode after 20 warm-up cycles.',
    'Portable regressions over 10 percent always require an explanation; environment-sensitive regressions do so on an equivalent runner.',
    "Cloudflare startup is Wrangler's local active CPU time for Worker module initialization; production hardware can differ.",
  ],
};

await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Benchmark baseline updated from ${input}`);

function compactBundle(bundle) {
  if (!bundle) return null;
  const { path: _path, baseline, ...measurement } = bundle;
  if (!baseline) return measurement;
  const { path: _baselinePath, ...baselineMeasurement } = baseline;
  return { ...measurement, baseline: baselineMeasurement };
}
