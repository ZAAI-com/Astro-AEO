import { describe, expect, it } from 'vitest';
import {
  compareBenchmarkReports,
  findBenchmarkRegressionExplanations,
  hasBenchmarkRegressionExplanation,
} from '../benchmarks/comparison.mjs';

const baselineEnvironment = {
  node: 'v24.0.0',
  platform: 'darwin',
  architecture: 'arm64',
  ci: false,
  runnerClass: 'reference-mac',
};

describe('benchmark regression comparison', () => {
  it('gates portable size regressions when release CI runs on another platform', () => {
    const baseline = report({ packedBytes: 100, parseMs: 10 }, baselineEnvironment);
    const current = report(
      { packedBytes: 111, parseMs: 20 },
      { ...baselineEnvironment, platform: 'linux', architecture: 'x64', ci: true },
    );

    const comparison = compareBenchmarkReports(current, baseline);

    expect(comparison.comparable).toBe(true);
    expect(comparison.portable.metricsCompared).toBe(1);
    expect(comparison.portable.regressions).toEqual([
      expect.objectContaining({
        metric: 'packed package bytes',
        portability: 'portable',
        changePercent: 11,
      }),
    ]);
    expect(comparison.environmentSensitive.comparable).toBe(false);
    expect(comparison.regressions).toHaveLength(1);
  });

  it('gates integration deltas even when the total adapter bundle barely changes', () => {
    const baseline = report({ packedBytes: 100, parseMs: 10 });
    const current = report({ packedBytes: 100, parseMs: 10 });
    baseline.bundles = {
      cloudflare: { rawBytes: 1_000_000, deltaRawBytes: 10_000 },
    };
    current.bundles = {
      cloudflare: { rawBytes: 1_001_100, deltaRawBytes: 11_100 },
    };

    const comparison = compareBenchmarkReports(current, baseline);
    expect(comparison.portable.regressions).toEqual([
      expect.objectContaining({ metric: 'Cloudflare integration delta raw bytes', changePercent: 11 }),
    ]);
  });

  it('compares timings and Worker startup only on an equivalent runner', () => {
    const baseline = report({ packedBytes: 100, parseMs: 10, previewReadyMs: 100 });
    const current = report({ packedBytes: 100, parseMs: 12, previewReadyMs: 111 });

    const comparison = compareBenchmarkReports(current, baseline);

    expect(comparison.environmentSensitive.comparable).toBe(true);
    expect(comparison.environmentSensitive.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: '100000-byte parse p95' }),
        expect.objectContaining({
          metric: 'Cloudflare Worker startup active time',
        }),
      ]),
    );
  });
});

describe('benchmark regression explanations', () => {
  it('accepts the explicit marker from a pending changeset or current release changelog', () => {
    const explanations = findBenchmarkRegressionExplanations({
      version: '1.1.0',
      changesets: [
        {
          name: 'fast-bears.md',
          contents:
            '---\n"astro-aeo": minor\n---\n\nBenchmark regression explanation: The bundle grows to preserve edge-safe DOM parsing.',
        },
      ],
      changelog: [
        '# Changelog',
        '',
        '## 1.1.0',
        '',
        '- Benchmark regression explanation: Request latency grows because auth now runs on Markdown.',
        '',
        '## 1.0.0',
        '',
        '- Benchmark regression explanation: This older note must not decide the current release.',
      ].join('\n'),
    });

    expect(explanations).toEqual([
      '.changeset/fast-bears.md',
      'CHANGELOG.md#1.1.0',
    ]);
  });

  it('rejects generic benchmark mentions and short marker text', () => {
    expect(
      hasBenchmarkRegressionExplanation(
        'Adds reproducible performance benchmarks and a package size report.',
      ),
    ).toBe(false);
    expect(hasBenchmarkRegressionExplanation('Benchmark regression explanation: too short')).toBe(
      false,
    );
    expect(
      findBenchmarkRegressionExplanations({
        version: '1.1.0',
        changelog:
          '## 1.1.0\n\nNo accepted regression.\n\n## 1.0.0\n\nBenchmark regression explanation: This applies only to the older release.',
      }),
    ).toEqual([]);
  });
});

function report(values, environment = baselineEnvironment) {
  return {
    environment,
    package: { packedBytes: values.packedBytes },
    extraction: {
      100000: { parse: { p95Ms: values.parseMs } },
    },
    cloudflareStartupMs: values.previewReadyMs,
  };
}
