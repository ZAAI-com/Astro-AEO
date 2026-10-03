# Astro-AEO release benchmarks

The benchmark harness records extraction time, retained heap, package size, runtime corpus fan-out,
optional request latency, and optional adapter bundle sizes as JSON.

```bash
node --expose-gc benchmarks/run.mjs
node --expose-gc benchmarks/run.mjs --enforce
```

Results are written to `.astro/aeo-benchmarks/1.6.json`. That path is ignored by git. Use the same
Node version and runner class when comparing results; absolute timing from unrelated machines is
not meaningful.

Extraction uses 50 samples for 10 KB, 100 for 100 KB, and 20 for 1 MB after warming each size.
These minimums keep nearest-rank p95 measurements from being decided by one incidental pause.

`node scripts/run-release-benchmark.mjs` boots the built Node adapter fixture and the Cloudflare
fixture through the workerd-backed `astro preview` command. It also runs `wrangler check startup`
against the built Worker and records the profile's active module-initialization CPU time. The full
release check uses this path so request latency, conditional responses, local Worker startup, and a
successful workerd-backed request are all measured rather than skipped. Local CPU profiles are
reproducible on equivalent runners, but production Cloudflare hardware can differ.

To include request latency against a running fixture:

```bash
node --expose-gc benchmarks/run.mjs \
  --request-origin http://127.0.0.1:4321 \
  --html-path /about \
  --markdown-path /about.md
```

To inspect built adapter artifacts, pass `--node-bundle` or `--cloudflare-bundle`. Each accepts a
file or directory. Source maps are excluded. Add `--node-baseline-bundle` or
`--cloudflare-baseline-bundle` for the equivalent build without Astro-AEO; the report then records
raw and gzip deltas. A custom runner may pass locally profiled active startup time as
`--cloudflare-startup-ms`. `--require-complete` fails when requests, either bundle, or that Worker
startup measurement is absent.

The release check builds minimal Node and Cloudflare fixtures without Astro-AEO, then compares them
with the equivalent adapter fixtures. This keeps the reported delta separate from Astro and adapter
framework code that both builds share.

`--enforce` applies the 1.4 safety ceilings embedded in the report:

- Packed package at most 500,000 bytes and unpacked package at most 1,900,000 bytes.
  The measured 1.6.0 envelope (489,712 packed / 1,876,024 unpacked) was explicitly
  approved on 2026-10-04; prior ceilings were 450,000 / 1,530,000 bytes. The 1.5.3
  review-fix snapshot measured 400,193 packed and 1,523,619 unpacked bytes across 185 files.
  Bounded schema processing, offline URL bases, Markdown filtering and component guards account
  for the growth; packed and runtime bundle ceilings stay unchanged. The measured
  1.5.2 package is 383,686 packed and 1,460,846 unpacked bytes across 174 files; 1.5.0 was 377,711
  packed and 1,443,195 unpacked across 173 files. 1.4.0 was 355,650 packed and 1,375,031 unpacked
  (1.3.1 was 290,286 and 1,163,361; 1.3 was 272,377 and 1,106,331). The packed ceiling is
  deliberately loose: it exists to catch a dependency-scale mistake, not to gate ordinary
  correctness work, and the unpacked ceiling plus the absolute bundle, startup, memory, and request
  ceilings below stay close to their measurements.
- 100 KB parse p95 below 50 ms and conversion p95 below 150 ms.
- A denser 100 KB document built from the 1.5 extraction cases (hidden separators and tree glyphs,
  a definition term with an icon, a two-image figure, a Shiki code block) converts with a p95 below
  300 ms. It is reported as `extraction['100000-rich']` and is not part of the baseline comparison.
- Retained heap after 100 conversions at most 10 MB.
- Paired Markdown-minus-HTML p95 request overhead at most 10 ms. Direct and negotiated modes each
  use 200 interleaved pairs after 20 warm-up cycles, with alternating request order. Raw latency
  and overhead samples remain in the JSON report.
- Runtime corpus fan-out at most one render at a time, with 51 pages refused before rewriting.
- Cloudflare output at most 51.2 MB raw and 2.4 MB gzip, with locally profiled Worker startup
  active time below 800 ms.

The committed 1.4 baseline records package and Node/Cloudflare bundle byte counts plus a complete
reference measurement on the declared M2 Pro runner. The portable measurements always receive the 10 percent comparison in tag CI. The initial 1.2
reference deliberately omits timing and memory samples because it was recorded on a shared,
non-idle machine; the absolute timing, memory, request, and Worker-startup ceilings remain enforced
by every complete release run. A later complete reference may add those comparisons only after it
is measured on a controlled runner. Timing and retained-heap comparisons run only when the exact
Node version, platform, architecture, CI mode, and explicitly declared runner class match. Set
`ASTRO_AEO_BENCHMARK_RUNNER` to a stable runner-class name when repeating measurements on controlled
hardware.

A portable package or bundle change over 10 percent always requires an explanation. Timing,
memory, corpus, request, and startup changes over 10 percent require one when the runner matches
the committed reference environment. Incomparable runners still enforce every absolute ceiling
but do not claim a relative regression. Explanations use at least 20 characters after this marker:

```text
Benchmark regression explanation: <what grew slower or larger, why, and the accepted tradeoff>
```

The marker may appear in a pending changeset. After `changeset version` consumes that file, the
same text remains valid in the exact current-version `CHANGELOG.md` section. Tag release metadata
continues to reject any unconsumed changeset. A generic mention of performance or benchmarks is not
an explanation. Safety ceilings always fail release checks.

To refresh the committed reference after an intentional benchmark-method change, first record a
complete passing report on the declared reference runner, then update the baseline:

```bash
ASTRO_AEO_BENCHMARK_RUNNER=astro-aeo-m2-pro-reference \
  node scripts/run-release-benchmark.mjs \
  --baseline none \
  --output .astro/aeo-benchmarks/1.4-reference.json
pnpm run benchmark:baseline
```

The updater refuses reports without a runner class or with a failed safety ceiling. Raw request
samples remain in the private report and are intentionally omitted from the committed summary.

A manual W1-Test dispatch also runs the complete release gate on a fresh GitHub-hosted runner,
without publishing or using a release tag. Use that job to check the candidate when unrelated
local workloads prevent a repeatable timing result. It enforces the same absolute ceilings, does
not claim a reference-runner timing comparison, and does not replace final semantic sign-off.

A shared machine can measure the deterministic sizes but not the timings. Pass `--sizes-only` to
record just the package and bundle byte counts:

```bash
ASTRO_AEO_BENCHMARK_RUNNER=portable-size-only \
  node scripts/run-release-benchmark.mjs \
  --baseline none \
  --output .astro/aeo-benchmarks/1.4-reference.json
node scripts/update-benchmark-baseline.mjs --sizes-only
```

The complete run still has to pass every absolute ceiling, so a size-only reference is a full
measurement with the environment-sensitive samples withheld rather than a partial one. Keep the
machine idle: unrelated builds or test runs inflate the conversion p95 enough to fail the run.

Conditional requests currently avoid response bytes but still calculate the Markdown
representation. The request report records this explicitly and must not describe a `304` as a
conversion-cache hit.

## 1.6 project and incremental evidence

The default microbenchmark comparison uses `baseline-postfix-29729bb.json`: a reconstructed
post-fix snapshot, not a published 1.5.4 release. Its package already exceeded the prior
1,530,000-byte unpacked ceiling by 283 bytes. Do not label a diagnostic overage run a passing release gate.

```bash
node benchmarks/projects.mjs --baseline-root .context/baseline-postfix-29729bb \
  --samples 3 --counts 10,1000,10000 --output .context/batch12-projects.json --enforce
```

The baseline must be a clean detached checkout at `29729bb` with dependencies installed. The
harness generates real deterministic Astro projects, alternates control/reconstructed/current
order, and measures each build in a fresh process with the same Node and Astro. Each current
project then receives an unchanged build and a single-page edit. Median and nearest-rank p95
include raw paired samples; three samples are descriptive, not a statistically robust tail estimate.
Peak RSS and end-of-build heap are separate from the existing post-GC retained-heap ceiling.
Framework startup and page rendering are included in build duration; package and public output
bytes are reported separately. Private trace evidence counts normalization and graph cache work.

Warm normalization must hit every page; a one-page edit must miss exactly once. These conditions
fail on every runner, independently of `--enforce`. The focused 10,000-page regression additionally
spies on actual extraction and renderer calls, proving zero warm calls and exactly one reconversion.
Fixed-input public output ceilings are 12,856 / 1,245,586 / 12,648,586 bytes for 10 / 1,000 /
10,000 pages. The first two match reconstructed output; the last is a measured current contract,
not historical extrapolation. Every sample, warm output equality and repeated cold determinism
are blocking. Other page counts require a reviewed byte contract. These guards do not increase
a prior output allowance. The project gate applies the explicitly approved package ceilings. Bundle bytes and retained heap are still
blocking in the complete microbenchmark gate. Output growth cannot be hidden in a timing ratio.

The 5% timing-overhead target is evaluated only on the declared controlled reference runner.
Local paired ratios remain descriptive; a null runner class cannot establish that target. Existing
absolute microbenchmark safety limits remain in force. No uncontrolled result replaces the
reference baseline. Measurements should run without concurrent tests or install jobs.

Reconstructed real-project comparisons default to at most 1,000 pages. Profiling showed
quadratic destination-pair validation in the unmodified baseline; extrapolating that run to
10,000 pages is not a completed measurement. The 10,000-page evidence still uses three
paired control/current builds plus warm and one-edit passes, with all actual work counts.
Use `--baseline-project-max-pages 10000` only when explicitly collecting the long historical
comparison. Missing historical timings are null, never extrapolated or reported as passing.

`pnpm run benchmark:projects` prepares a detached, ignored baseline worktree when necessary,
uses the same installed comparison dependencies, and removes only a worktree it created.
The archived baseline JSON retains its original independent toolchain and measurements.

## Reviewed local 1.6.0 evidence

[Local complete measurements](1.6.0-local.json) and [real projects](1.6.0-projects.json) are
reviewed working-tree evidence, not replacement reference baselines or passing release gates.
The latter includes two source-frozen current/control pairs and separately labelled three-sample
reconstructed results up to 1,000 pages. Control loads the integration module without registering
it. These archived reports failed the prior package ceilings at review. The new 500,000 /
1,900,000 ceilings are explicitly approved; subsequent gate results are recorded separately.
Reference-runner relative timing and the 5% target remain unverified. See [release preparation](../docs/release-evidence/1.6.0-release-preparation.md).
