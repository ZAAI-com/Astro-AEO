#!/usr/bin/env node
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { parseDocument } from '../src/core/html-document.js';
import {
  DEFAULT_EXTRACTION,
  htmlToMarkdownWithDiagnostics,
} from '../src/core/html-to-md.js';
import { resolveConfig } from '../src/config.js';
import { RuntimeCorpusLimitError, serveLlmsIndex } from '../src/runtime/serve.js';
import { RELEASE_THRESHOLDS } from './thresholds.mjs';
import {
  compareBenchmarkReports,
  findBenchmarkRegressionExplanations,
} from './comparison.mjs';
import {
  measurePairedRequestLatency,
  summarizeLatency,
} from './request-latency.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const enforce = Boolean(args.enforce);
const requireComplete = Boolean(args['require-complete']);
const iterations = positiveInteger(args.iterations, 20);
const outputPath = resolve(root, String(args.output ?? '.astro/aeo-benchmarks/1.2.json'));
const baselinePath = args.baseline === 'none'
  ? null
  : resolve(root, String(args.baseline ?? 'benchmarks/baseline-1.2.json'));
const thresholds = RELEASE_THRESHOLDS;
const os = await import('node:os');

const documents = new Map(
  [10_000, 100_000, 1_000_000].map((size) => [size, makeDocument(size)]),
);

const extraction = {};
for (const [size, html] of documents) {
  // Warm each document size independently so allocation and parser setup are
  // not mistaken for steady-state latency. Larger sample sets keep nearest-rank
  // p95 from turning one or two incidental pauses into the release result.
  parseDocument(html);
  await convert(html);
  const samples = size >= 1_000_000
    ? Math.max(iterations, 20)
    : size >= 100_000
      ? Math.max(iterations, 100)
      : Math.max(iterations, 50);
  extraction[String(size)] = {
    bytes: Buffer.byteLength(html),
    parse: summarize(await sample(samples, () => parseDocument(html))),
    convert: summarize(await sample(samples, () => convert(html))),
  };
}

const memory = await measureRetainedHeap(documents.get(100_000), 100);
const packageSize = packageMetadata();
const corpus = await benchmarkCorpus();
const requests = args['request-origin']
  ? await benchmarkRequests(String(args['request-origin']), iterations, {
      htmlPath: String(args['html-path'] ?? '/about'),
      markdownPath: String(args['markdown-path'] ?? '/about.md'),
    })
  : null;
const bundles = {
  node: await measureBundlePair(args['node-bundle'], args['node-baseline-bundle']),
  cloudflare: await measureBundlePair(
    args['cloudflare-bundle'],
    args['cloudflare-baseline-bundle'],
  ),
};
const cloudflareStartupMs = args['cloudflare-startup-ms'] === undefined
  ? null
  : Number(args['cloudflare-startup-ms']);

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpus: Number(process.env.CI ? 0 : os.cpus().length) || undefined,
    ci: Boolean(process.env.CI),
    runnerClass: benchmarkRunnerClass(),
  },
  thresholds,
  package: packageSize,
  extraction,
  memory,
  corpus,
  requests,
  bundles,
  cloudflareStartupMs,
};

const baseline = baselinePath ? await readBaseline(baselinePath) : null;
report.comparison = baseline
  ? await compareWithBaseline(report, baseline)
  : { comparable: false, reason: 'Baseline comparison disabled.', regressions: [] };
const failures = evaluate(report, thresholds, { requireComplete });
if (
  report.comparison.comparable &&
  report.comparison.regressions.length > 0 &&
  report.comparison.explainedBy.length === 0
) {
  failures.push(
    `${report.comparison.regressions.length} comparable benchmark metric(s) regressed by more than 10 percent without a "Benchmark regression explanation:" in a pending changeset or the current-version changelog`,
  );
}
report.failures = failures;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const consoleReport = report.requests?.rawSamplesMs
  ? {
      ...report,
      requests: {
        ...report.requests,
        rawSamplesMs: `Recorded in ${outputPath}`,
      },
    }
  : report;
console.log(JSON.stringify(consoleReport, null, 2));
console.error(`Benchmark report written to ${outputPath}`);

if (failures.length > 0) {
  const label = enforce ? 'FAILED' : 'WOULD FAIL WITH --enforce';
  for (const failure of failures) console.error(`${label}: ${failure}`);
  if (enforce) process.exitCode = 1;
}

async function convert(html) {
  return htmlToMarkdownWithDiagnostics(html, DEFAULT_EXTRACTION, undefined, {
    baseUrl: 'https://example.test/benchmark',
  });
}

async function sample(count, operation) {
  const values = [];
  for (let index = 0; index < count; index++) {
    const start = performance.now();
    await operation();
    values.push(performance.now() - start);
  }
  return values;
}

function summarize(values) {
  return summarizeLatency(values);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function measureRetainedHeap(html, conversions) {
  if (typeof global.gc !== 'function') {
    return { conversions, retainedBytes: null, note: 'Run Node with --expose-gc to measure retained heap.' };
  }
  await convert(html);
  global.gc();
  const before = process.memoryUsage();
  for (let index = 0; index < conversions; index++) await convert(html);
  global.gc();
  const after = process.memoryUsage();
  return {
    conversions,
    retainedBytes: Math.max(0, after.heapUsed - before.heapUsed),
    rssDeltaBytes: after.rss - before.rss,
    beforeHeapBytes: before.heapUsed,
    afterHeapBytes: after.heapUsed,
  };
}

function packageMetadata() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'npm pack --dry-run failed');
  const metadata = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))[0];
  return {
    packedBytes: metadata.size,
    unpackedBytes: metadata.unpackedSize,
    files: metadata.entryCount,
  };
}

async function benchmarkCorpus() {
  const measurements = {};
  for (const pageCount of [1, 10, 50]) {
    const runtime = runtimeFor(pageCount);
    let active = 0;
    let peakConcurrency = 0;
    let fetches = 0;
    const start = performance.now();
    const body = await serveLlmsIndex('llms', runtime, async (pathname) => {
      fetches++;
      active++;
      peakConcurrency = Math.max(peakConcurrency, active);
      await new Promise((done) => setTimeout(done, 1));
      active--;
      const html = pageHtml(pathname);
      return {
        html,
        response: new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      };
    });
    measurements[String(pageCount)] = {
      durationMs: round(performance.now() - start),
      fetches,
      peakConcurrency,
      outputBytes: Buffer.byteLength(body),
    };
  }

  let refusal;
  let fetches = 0;
  const start = performance.now();
  try {
    await serveLlmsIndex('llms', runtimeFor(51), async () => {
      fetches++;
      const html = pageHtml('/unexpected');
      return {
        html,
        response: new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      };
    });
    refusal = false;
  } catch (error) {
    refusal = error instanceof RuntimeCorpusLimitError;
    if (!refusal) throw error;
  }
  measurements['51'] = {
    durationMs: round(performance.now() - start),
    fetches,
    refused: refusal,
  };
  return measurements;
}

function runtimeFor(pageCount) {
  return {
    command: 'build',
    config: resolveConfig({ corpus: { runtime: { maxPages: 50 } } }),
    site: {
      siteUrl: 'https://example.test',
      base: '',
      trailingSlash: 'ignore',
      buildFormat: 'directory',
    },
    staticPaths: Array.from({ length: pageCount }, (_, index) =>
      index === 0 ? '/' : `/benchmark-${index}`,
    ),
    standaloneSources: {},
  };
}

function pageHtml(pathname) {
  return `<!doctype html><html><head><title>${pathname}</title><meta name="description" content="Benchmark page" /></head><body><main><h1>${pathname}</h1><p>Deterministic benchmark content.</p></main></body></html>`;
}

async function benchmarkRequests(origin, count, paths) {
  const base = origin.replace(/\/$/, '');
  const firstStart = performance.now();
  const first = await fetch(`${base}${paths.htmlPath}`);
  await first.arrayBuffer();
  const firstResponseMs = performance.now() - firstStart;

  const latency = await measurePairedRequestLatency(async (kind) => {
    const request = kind === 'directMarkdown'
      ? { url: `${base}${paths.markdownPath}`, init: undefined, label: 'direct Markdown' }
      : kind === 'negotiatedMarkdown'
        ? {
            url: `${base}${paths.htmlPath}`,
            init: { headers: { accept: 'text/markdown, text/html;q=0.5' } },
            label: 'negotiated Markdown',
          }
        : { url: `${base}${paths.htmlPath}`, init: undefined, label: 'HTML' };
    const start = performance.now();
    const response = await fetch(request.url, request.init);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${request.label} benchmark returned ${response.status}`);
    return performance.now() - start;
  }, { pairs: Math.max(count, 200), warmup: 20 });

  const etagResponse = await fetch(`${base}${paths.markdownPath}`);
  await etagResponse.arrayBuffer();
  const etag = etagResponse.headers.get('etag');
  const conditional = etag
    ? await fetch(`${base}${paths.markdownPath}`, { headers: { 'if-none-match': etag } })
    : null;
  if (conditional) await conditional.arrayBuffer();

  return {
    firstResponseMs: round(firstResponseMs),
    ...latency,
    conditionalStatus: conditional?.status ?? null,
    note: 'A 304 avoids response bytes but the current runtime still calculates the representation.',
  };
}

async function measureBundle(path) {
  const info = await stat(path);
  const files = info.isDirectory() ? await filesBelow(path) : [path];
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const contents = await readFile(file);
    rawBytes += contents.byteLength;
    gzipBytes += gzipSync(contents).byteLength;
  }
  return { path, files: files.length, rawBytes, gzipBytes };
}

async function measureBundlePair(withIntegration, withoutIntegration) {
  if (!withIntegration) return null;
  const measured = await measureBundle(resolve(root, String(withIntegration)));
  if (!withoutIntegration) return measured;
  const baseline = await measureBundle(resolve(root, String(withoutIntegration)));
  return {
    ...measured,
    baseline,
    deltaRawBytes: measured.rawBytes - baseline.rawBytes,
    deltaGzipBytes: measured.gzipBytes - baseline.gzipBytes,
  };
}

async function filesBelow(path) {
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) found.push(...(await filesBelow(child)));
    else if (entry.isFile() && !entry.name.endsWith('.map')) found.push(child);
  }
  return found;
}

function evaluate(report, limits, options) {
  const failures = [];
  const parse100 = report.extraction['100000'].parse.p95Ms;
  const convert100 = report.extraction['100000'].convert.p95Ms;
  if (report.package.packedBytes > limits.packagePackedBytes) {
    failures.push(`packed package ${report.package.packedBytes} > ${limits.packagePackedBytes} bytes`);
  }
  if (report.package.unpackedBytes > limits.packageUnpackedBytes) {
    failures.push(`unpacked package ${report.package.unpackedBytes} > ${limits.packageUnpackedBytes} bytes`);
  }
  if (parse100 > limits.parse100KbP95Ms) failures.push(`100 KB parse p95 ${parse100} > ${limits.parse100KbP95Ms} ms`);
  if (convert100 > limits.convert100KbP95Ms) failures.push(`100 KB conversion p95 ${convert100} > ${limits.convert100KbP95Ms} ms`);
  if (report.memory.retainedBytes !== null && report.memory.retainedBytes > limits.retainedHeapBytes) {
    failures.push(`retained heap ${report.memory.retainedBytes} > ${limits.retainedHeapBytes} bytes`);
  }
  for (const count of ['1', '10', '50']) {
    if (report.corpus[count].peakConcurrency > limits.corpusConcurrency) {
      failures.push(`corpus ${count} used ${report.corpus[count].peakConcurrency} concurrent renders`);
    }
  }
  if (!report.corpus['51'].refused || report.corpus['51'].fetches !== 0) {
    failures.push('51-page corpus was not refused before rendering');
  }
  if (report.requests?.p95OverheadMs > limits.requestP95OverheadMs) {
    failures.push(`Markdown request p95 overhead ${report.requests.p95OverheadMs} > ${limits.requestP95OverheadMs} ms`);
  }
  if (report.requests && report.requests.conditionalStatus !== 304) {
    failures.push(`conditional Markdown request returned ${report.requests.conditionalStatus}, expected 304`);
  }
  if (report.bundles.cloudflare?.rawBytes > limits.cloudflareRawBytes) {
    failures.push(`Cloudflare raw bundle ${report.bundles.cloudflare.rawBytes} > ${limits.cloudflareRawBytes} bytes`);
  }
  if (report.bundles.cloudflare?.gzipBytes > limits.cloudflareGzipBytes) {
    failures.push(`Cloudflare gzip bundle ${report.bundles.cloudflare.gzipBytes} > ${limits.cloudflareGzipBytes} bytes`);
  }
  if (
    report.cloudflareStartupMs !== null &&
    report.cloudflareStartupMs > limits.cloudflareStartupMs
  ) {
    failures.push(
      `Cloudflare Worker startup active time ${report.cloudflareStartupMs} > ${limits.cloudflareStartupMs} ms`,
    );
  }
  if (options.requireComplete) {
    if (!report.requests) failures.push('request benchmarks were not recorded');
    if (!report.bundles.node) failures.push('Node bundle sizes were not recorded');
    if (!report.bundles.cloudflare) failures.push('Cloudflare bundle sizes were not recorded');
    if (
      report.cloudflareStartupMs === null ||
      !Number.isFinite(report.cloudflareStartupMs)
    ) {
      failures.push('Cloudflare Worker startup active time was not recorded');
    }
  }
  return failures;
}

async function readBaseline(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error(`Benchmark baseline does not exist: ${path}`);
    }
    throw error;
  }
}

async function compareWithBaseline(report, baseline) {
  const comparison = compareBenchmarkReports(report, baseline);
  if (comparison.regressions.length === 0) return comparison;
  return compareBenchmarkReports(report, baseline, await explanatoryBenchmarkNotes());
}

async function explanatoryBenchmarkNotes() {
  const directory = resolve(root, '.changeset');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') entries = [];
    else throw error;
  }

  const changesets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
    changesets.push({
      name: entry.name,
      contents: await readFile(resolve(directory, entry.name), 'utf8'),
    });
  }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
  return findBenchmarkRegressionExplanations({
    changesets,
    changelog,
    version: pkg.version,
  });
}

function benchmarkRunnerClass() {
  if (process.env.ASTRO_AEO_BENCHMARK_RUNNER) return process.env.ASTRO_AEO_BENCHMARK_RUNNER;
  return null;
}

function makeDocument(targetBytes) {
  const prefix = '<!doctype html><html><head><title>Benchmark</title></head><body><main><article><h1>Benchmark</h1>';
  const suffix = '</article></main></body></html>';
  const block = '<section><h2>Deterministic heading</h2><p>Astro-AEO benchmark text with <a href="/relative">a relative link</a> and repeatable content.</p><pre><code class="language-js">const value = 42;</code></pre></section>';
  const count = Math.max(1, Math.ceil((targetBytes - prefix.length - suffix.length) / block.length));
  return `${prefix}${block.repeat(count)}${suffix}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const equals = argument.indexOf('=');
    if (equals >= 0) parsed[argument.slice(2, equals)] = argument.slice(equals + 1);
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) parsed[argument.slice(2)] = argv[++index];
    else parsed[argument.slice(2)] = true;
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}
