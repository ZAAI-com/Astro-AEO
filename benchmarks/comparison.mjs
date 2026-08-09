const PORTABLE_METRICS = [
  ['package.packedBytes', 'packed package bytes'],
  ['package.unpackedBytes', 'unpacked package bytes'],
  ['bundles.node.rawBytes', 'Node bundle raw bytes'],
  ['bundles.node.gzipBytes', 'Node bundle gzip bytes'],
  ['bundles.node.deltaRawBytes', 'Node integration delta raw bytes'],
  ['bundles.node.deltaGzipBytes', 'Node integration delta gzip bytes'],
  ['bundles.cloudflare.rawBytes', 'Cloudflare bundle raw bytes'],
  ['bundles.cloudflare.gzipBytes', 'Cloudflare bundle gzip bytes'],
  ['bundles.cloudflare.deltaRawBytes', 'Cloudflare integration delta raw bytes'],
  ['bundles.cloudflare.deltaGzipBytes', 'Cloudflare integration delta gzip bytes'],
];

const ENVIRONMENT_SENSITIVE_METRICS = [
  ['memory.retainedBytes', 'retained heap after 100 conversions'],
  ['requests.html.p95Ms', 'HTML request p95'],
  ['requests.directMarkdown.p95Ms', 'direct Markdown request p95'],
  ['requests.negotiatedMarkdown.p95Ms', 'negotiated Markdown request p95'],
  ['requests.p95OverheadMs', 'Markdown request p95 overhead'],
  ['cloudflareStartupMs', 'Cloudflare Worker startup active time'],
];

for (const size of ['10000', '100000', '1000000']) {
  ENVIRONMENT_SENSITIVE_METRICS.push(
    [`extraction.${size}.parse.p95Ms`, `${size}-byte parse p95`],
    [`extraction.${size}.convert.p95Ms`, `${size}-byte conversion p95`],
  );
}
for (const count of ['1', '10', '50', '51']) {
  ENVIRONMENT_SENSITIVE_METRICS.push(
    [`corpus.${count}.durationMs`, `${count}-route corpus duration`],
  );
}

/**
 * Compare deterministic sizes on every runner and timings only on equivalent hardware.
 * @param {Record<string, any>} current
 * @param {Record<string, any>} baseline
 * @param {string[]} [explainedBy]
 */
export function compareBenchmarkReports(current, baseline, explainedBy = []) {
  const portable = compareMetrics(current, baseline, PORTABLE_METRICS, 'portable');
  const timingReason = timingIncomparableReason(current.environment, baseline.environment);
  const environmentSensitive = timingReason
    ? { comparable: false, reason: timingReason, metricsCompared: 0, regressions: [] }
    : {
        comparable: true,
        reason: 'The timing runner environment matches the baseline.',
        ...compareMetrics(
          current,
          baseline,
          ENVIRONMENT_SENSITIVE_METRICS,
          'environment-sensitive',
        ),
      };
  const regressions = [...portable.regressions, ...environmentSensitive.regressions];
  const comparable = portable.metricsCompared > 0 || environmentSensitive.metricsCompared > 0;
  return {
    comparable,
    reason: timingReason
      ? `Portable size metrics were compared. Environment-sensitive metrics were skipped: ${timingReason}`
      : 'Portable sizes and environment-sensitive metrics were compared.',
    regressions,
    explainedBy: regressions.length > 0 ? [...explainedBy] : [],
    portable: {
      comparable: portable.metricsCompared > 0,
      reason: 'Package and bundle byte counts are portable across release runners.',
      ...portable,
    },
    environmentSensitive,
  };
}

/**
 * Find an explicit explanation in an unconsumed changeset or the current release section.
 * The marker survives `changeset version`, so tag CI can validate a consumed explanation.
 * @param {{
 *   changesets?: Array<{name: string, contents: string}>,
 *   changelog?: string,
 *   version: string,
 * }} input
 */
export function findBenchmarkRegressionExplanations(input) {
  const found = [];
  for (const changeset of input.changesets ?? []) {
    if (hasBenchmarkRegressionExplanation(changeset.contents)) {
      found.push(`.changeset/${changeset.name}`);
    }
  }
  const releaseSection = currentVersionSection(input.changelog ?? '', input.version);
  if (hasBenchmarkRegressionExplanation(releaseSection)) {
    found.push(`CHANGELOG.md#${input.version}`);
  }
  return found.sort();
}

/** @param {string} text */
export function hasBenchmarkRegressionExplanation(text) {
  const marker = /benchmark regression explanation\s*:\s*/gi;
  let match;
  while ((match = marker.exec(text))) {
    const remainder = text.slice(match.index + match[0].length);
    const nextBoundary = remainder.search(/\n(?=\s*(?:[-*]\s|#{1,3}\s))/);
    const explanation = (nextBoundary < 0 ? remainder : remainder.slice(0, nextBoundary))
      .replace(/\s+/g, ' ')
      .trim();
    if (explanation.length >= 20) return true;
  }
  return false;
}

function compareMetrics(current, baseline, definitions, portability) {
  const regressions = [];
  let metricsCompared = 0;
  for (const [path, label] of definitions) {
    const currentValue = valueAt(current, path);
    const previousValue = valueAt(baseline, path);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue <= 0) {
      continue;
    }
    metricsCompared++;
    const change = ((currentValue - previousValue) / previousValue) * 100;
    if (change > 10) {
      regressions.push({
        metric: label,
        portability,
        baseline: round(previousValue),
        current: round(currentValue),
        changePercent: round(change),
      });
    }
  }
  return { metricsCompared, regressions };
}

function timingIncomparableReason(current, baseline) {
  for (const key of ['node', 'platform', 'architecture', 'ci', 'runnerClass']) {
    if (current?.[key] !== baseline?.[key]) {
      return `${key} differs (${String(baseline?.[key])} versus ${String(current?.[key])})`;
    }
  }
  return null;
}

function currentVersionSection(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## ${escaped}\\s*$`, 'm');
  const start = heading.exec(changelog);
  if (!start) return '';
  const contentsStart = start.index + start[0].length;
  const rest = changelog.slice(contentsStart);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function valueAt(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
