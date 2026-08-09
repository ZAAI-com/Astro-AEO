# Astro-AEO 1.1 Benchmarks

The benchmark harness records extraction time, retained heap, package size, runtime corpus fan-out,
optional request latency, and optional adapter bundle sizes as JSON.

```bash
node --expose-gc benchmarks/run.mjs
node --expose-gc benchmarks/run.mjs --enforce
```

Results are written to `.astro/aeo-benchmarks/1.1.json`. That path is ignored by git. Use the same
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

`--enforce` applies the 1.1 safety ceilings embedded in the report:

- Packed package at most 90,000 bytes and unpacked package at most 320,000 bytes.
- 100 KB parse p95 below 50 ms and conversion p95 below 150 ms.
- Retained heap after 100 conversions at most 10 MB.
- Paired Markdown-minus-HTML p95 request overhead at most 10 ms. Direct and negotiated modes each
  use 200 interleaved pairs after 20 warm-up cycles, with alternating request order. Raw latency
  and overhead samples remain in the JSON report.
- Runtime corpus fan-out at most one render at a time, with 51 pages refused before rewriting.
- Cloudflare output at most 51.2 MB raw and 2.4 MB gzip, with locally profiled Worker startup
  active time below 800 ms.

The committed baseline records 10 KB, 100 KB, and 1 MB extraction; memory after 100 conversions;
1, 10, 50, and 51-route corpora; requests; Node and Cloudflare bundles; and Cloudflare Worker
startup. Package and bundle byte counts are portable, so their 10 percent comparison always runs
in tag CI even when the committed baseline came from another operating system. Timing and retained
heap comparisons run only when the exact Node version, platform, architecture, CI mode, and an
explicitly declared runner class match. Set `ASTRO_AEO_BENCHMARK_RUNNER` to a stable runner-class
name when repeating measurements on controlled hardware.

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
  --output .astro/aeo-benchmarks/1.1-reference.json
pnpm run benchmark:baseline
```

The updater refuses reports without a runner class or with a failed safety ceiling. Raw request
samples remain in the private report and are intentionally omitted from the committed summary.

Conditional requests currently avoid response bytes but still calculate the Markdown
representation. The request report records this explicitly and must not describe a `304` as a
conversion-cache hit.
