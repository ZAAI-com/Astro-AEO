#!/usr/bin/env node
// Deterministic real Astro projects, not a renamed extraction microbenchmark.
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, utimes } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { RELEASE_THRESHOLDS } from './thresholds.mjs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const baseline = resolve(option('--baseline-root', join(root, '.context/baseline-postfix-29729bb')));
let createdBaseline = false;
if (args.includes('--prepare-baseline')) {
  try { await readFile(join(baseline, 'package.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(baseline), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', baseline, '29729bb'], { cwd: root, stdio: 'inherit' });
    await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    createdBaseline = true;
  }
}
const baselineRevision = execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!baselineRevision.startsWith('29729bb') || execFileSync('git', ['-C', baseline, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
  throw new Error('The reconstructed baseline must be a clean checkout of 29729bb.');
}
const samples = Number(option('--samples', '3'));
const baselineProjectMax = Number(option('--baseline-project-max-pages', '1000'));
const counts = option('--counts', '10,1000,10000').split(',').map(Number);
if (!Number.isSafeInteger(baselineProjectMax) || baselineProjectMax < 0 || !Number.isSafeInteger(samples) || samples < 2 || counts.some(n => !Number.isSafeInteger(n) || n < 1)) {
  throw new Error('Projects require at least two samples and positive integer page counts.');
}
// Fixed-input public output contracts, not a timing or historical extrapolation.
// 10/1,000 match the reconstructed baseline; 10,000 is the measured current contract.
const outputCeilings = { 10: 12856, 1000: 1245586, 10000: 12648586 };
const output = resolve(option('--output', '.context/batch12-projects.json'));
const temporary = await mkdtemp(join(tmpdir(), 'aeo-project-benchmark-'));
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))[0];
const report = { version: 1, package: { packedBytes: packed.size, unpackedBytes: packed.unpackedSize }, baseline: { revision: baselineRevision, kind: 'reconstructed-post-fix', publishedRelease: false },
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    astro: JSON.parse(await readFile(join(root, 'node_modules/astro/package.json'), 'utf8')).version,
    runnerClass: process.env.ASTRO_AEO_BENCHMARK_RUNNER ?? null }, samples,
  timingPolicy: 'Descriptive unless the declared reference runner matches; p95 uses nearest rank and small-sample uncertainty is disclosed.',
  outputByteCeilings: outputCeilings,
  baselineProjectMaxPages: baselineProjectMax,
  baselineCoverage: 'Complete microbenchmark baseline is archived separately; reconstructed real-project timings above this bound are not claimed.',
  projects: [], failures: [] };
if (args.includes('--enforce')) {
  if (packed.size > RELEASE_THRESHOLDS.packagePackedBytes) report.failures.push('Packed package exceeds the unchanged release ceiling.');
  if (packed.unpackedSize > RELEASE_THRESHOLDS.packageUnpackedBytes) report.failures.push('Unpacked package exceeds the unchanged release ceiling.');
}
function summary(values) { if (!values.length) return { median: null, p95: null, samples: [] }; const sorted = [...values].sort((a,b)=>a-b); const middle = Math.floor(sorted.length/2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2,
    p95: sorted[Math.ceil(sorted.length*0.95)-1], samples: values }; }
async function run(project, edit = false) {
  const destination = join(project, 'measurement.json');
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(root, 'benchmarks/project-worker.mjs'), project, destination], {
      cwd: root, env: { ...process.env, AEO_BENCH_EDIT: edit ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    child.stdout.on('data', data => { diagnostic = (diagnostic + data).slice(-8000); });
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-8000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept() : reject(new Error(`Astro project failed (${code}): ${diagnostic}`)));
  });
  return JSON.parse(await readFile(destination, 'utf8'));
}
try {
  for (const count of counts) {
    const measurements = { control: [], reconstructed: [], current: [], warm: [], edited: [] };
    for (let pair = 0; pair < samples; pair++) {
      // Alternate pair order to avoid consistently charging the first build's OS cache to one side.
      const order = pair % 2 ? ['current', 'reconstructed', 'control'] : ['control', 'reconstructed', 'current'];
      for (const variant of order) {
        if (variant === 'reconstructed' && count > baselineProjectMax) continue;
        const project = join(temporary, `${count}-${pair}-${variant}`);
        await mkdir(join(project, 'src/pages'), { recursive: true });
        await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
        await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
        const integration = pathToFileURL(join(variant === 'reconstructed' ? baseline : root, 'src/index.js')).href;
        await writeFile(join(project, 'astro.config.mjs'),
          `import aeo from ${JSON.stringify(integration)};\nexport default { site:'https://benchmark.example.test', integrations:${variant === 'control' ? '[]' : '[aeo()]'} };\n`);
        await writeFile(join(project, 'src/pages/[slug].astro'), `---\nexport function getStaticPaths() { return Array.from({length:${count}}, (_,index)=>({params:{slug:'p'+index},props:{index}})); }\nconst {index}=Astro.props;\nconst edit=process.env.AEO_BENCH_EDIT==='1' && index===0;\n---\n<html><head><title>Page {index}</title><meta name="description" content={'Deterministic page '+index} /></head><body><main><h1>Page {index}</h1><h2>Guide</h2><p>{edit ? 'Edited body' : 'Deterministic body'} {index}. Each page includes repeatable prose and a stable heading.</p><pre><code class="language-js">const value = 42;</code></pre></main></body></html>\n`);
        const fixedTime = new Date('2026-01-01T00:00:00Z');
        await utimes(join(project, 'src/pages/[slug].astro'), fixedTime, fixedTime);
        measurements[variant].push(await run(project));
        if (variant === 'current') {
          measurements.warm.push(await run(project));
          measurements.edited.push(await run(project, true));
          if (measurements.warm.at(-1).buildDigest !== measurements.current.at(-1).buildDigest) {
            report.failures.push(`${count} pages: unchanged build digest differs.`);
          }
          const coldOutput = measurements.current.at(-1).outputBytes;
          if (measurements.warm.at(-1).outputBytes !== coldOutput) {
            report.failures.push(`${count} pages: unchanged public output bytes differ.`);
          }
          if (measurements.current[0].outputBytes !== coldOutput) {
            report.failures.push(`${count} pages: paired public output bytes are not deterministic.`);
          }
          for (const variant of ['current', 'warm', 'edited']) {
            if (outputCeilings[count] === undefined || measurements[variant].at(-1).outputBytes > outputCeilings[count]) {
              report.failures.push(`${count} pages: ${variant} public output exceeds the fixed-input byte contract or lacks a reviewed contract.`);
            }
          }
          const warmWork = measurements.warm.at(-1).work;
          const editedWork = measurements.edited.at(-1).work;
          if (warmWork['normalization:hit'] !== count || warmWork['normalization:miss']) {
            report.failures.push(`${count} pages: warm normalization performs work.`);
          }
          if (editedWork['normalization:miss'] !== 1 || (editedWork['normalization:hit'] ?? 0) !== count-1) {
            report.failures.push(`${count} pages: one edit does not invalidate exactly one page.`);
          }
        }
        console.log(`${count} pages, pair ${pair+1}/${samples}, ${variant}: ${measurements[variant].at(-1).durationMs.toFixed(1)} ms`);
      }
    }
    report.projects.push({ count, measurements, summaries: Object.fromEntries(Object.entries(measurements).map(([variant, runs]) =>
      [variant, Object.fromEntries(['durationMs','peakRssBytes','heapUsedBytes','outputBytes'].map(key => [key, summary(runs.map(run => run[key]))]))])) });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (createdBaseline) execFileSync('git', ['worktree', 'remove', '--force', baseline], { cwd: root, stdio: 'inherit' });
}
console.log(`Project benchmark evidence: ${output}`);
if (report.failures.length) { console.error(report.failures.join('\n')); process.exitCode = 1; }
