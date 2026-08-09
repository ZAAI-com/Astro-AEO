const DEFAULT_PAIRS = 200;
const DEFAULT_WARMUP = 20;

/**
 * Measure direct and negotiated Markdown beside an HTML request made at nearly
 * the same time. Alternating request order prevents either representation from
 * consistently benefiting from being first in a pair.
 *
 * @param {(kind: 'html' | 'directMarkdown' | 'negotiatedMarkdown') => Promise<number>} request
 * @param {{ pairs?: number; warmup?: number }} [options]
 */
export async function measurePairedRequestLatency(request, options = {}) {
  const pairs = Math.max(DEFAULT_PAIRS, positiveInteger(options.pairs, DEFAULT_PAIRS));
  const warmup = positiveInteger(options.warmup, DEFAULT_WARMUP, true);

  for (let index = 0; index < warmup; index++) {
    await request('html');
    await request('directMarkdown');
    await request('negotiatedMarkdown');
  }

  const measurements = {
    directMarkdown: [],
    negotiatedMarkdown: [],
  };
  for (let index = 0; index < pairs; index++) {
    const kinds = index % 2 === 0
      ? ['directMarkdown', 'negotiatedMarkdown']
      : ['negotiatedMarkdown', 'directMarkdown'];
    for (const kind of kinds) {
      measurements[kind].push(await measurePair(request, kind, index % 2 === 1));
    }
  }
  return summarizePairedRequestLatency(measurements);
}

/**
 * @param {{
 *   directMarkdown: Array<{htmlMs: number; markdownMs: number}>;
 *   negotiatedMarkdown: Array<{htmlMs: number; markdownMs: number}>;
 * }} measurements
 */
export function summarizePairedRequestLatency(measurements) {
  const direct = summarizePairs(measurements.directMarkdown);
  const negotiated = summarizePairs(measurements.negotiatedMarkdown);
  const htmlSamples = [
    ...measurements.directMarkdown.map((pair) => pair.htmlMs),
    ...measurements.negotiatedMarkdown.map((pair) => pair.htmlMs),
  ];
  const directSamples = measurements.directMarkdown.map((pair) => pair.markdownMs);
  const negotiatedSamples = measurements.negotiatedMarkdown.map((pair) => pair.markdownMs);
  return {
    html: summarizeLatency(htmlSamples),
    directMarkdown: summarizeLatency(directSamples),
    negotiatedMarkdown: summarizeLatency(negotiatedSamples),
    overhead: {
      directMarkdown: summarizeLatency(direct.overheadMs),
      negotiatedMarkdown: summarizeLatency(negotiated.overheadMs),
    },
    p95OverheadMs: round(Math.max(
      0,
      percentileSorted(direct.overheadMs, 0.95),
      percentileSorted(negotiated.overheadMs, 0.95),
    )),
    rawSamplesMs: {
      html: htmlSamples.map(round),
      directMarkdown: directSamples.map(round),
      negotiatedMarkdown: negotiatedSamples.map(round),
      directOverhead: direct.overheadMs.map(round),
      negotiatedOverhead: negotiated.overheadMs.map(round),
    },
  };
}

/** @param {number[]} values */
export function summarizeLatency(values) {
  if (values.length === 0) {
    return { samples: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    medianMs: round(percentileSorted(sorted, 0.5, true)),
    p95Ms: round(percentileSorted(sorted, 0.95, true)),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
  };
}

async function measurePair(request, kind, markdownFirst) {
  if (markdownFirst) {
    const markdownMs = await request(kind);
    const htmlMs = await request('html');
    return { htmlMs, markdownMs };
  }
  const htmlMs = await request('html');
  const markdownMs = await request(kind);
  return { htmlMs, markdownMs };
}

function summarizePairs(pairs) {
  return {
    overheadMs: pairs.map((pair) => pair.markdownMs - pair.htmlMs),
  };
}

function percentileSorted(values, fraction, alreadySorted = false) {
  if (values.length === 0) return 0;
  const sorted = alreadySorted ? values : [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function positiveInteger(value, fallback, allowZero = false) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) return fallback;
  return number;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
