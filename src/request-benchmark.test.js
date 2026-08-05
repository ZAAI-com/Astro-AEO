import { describe, expect, it } from 'vitest';
import {
  measurePairedRequestLatency,
  summarizePairedRequestLatency,
} from '../benchmarks/request-latency.mjs';

describe('paired request benchmarks', () => {
  it('subtracts runner jitter shared by HTML and Markdown', () => {
    const pairs = Array.from({ length: 200 }, (_, index) => {
      const sharedJitter = index < 20 ? 50 : 0;
      return { htmlMs: 2 + sharedJitter, markdownMs: 5 + sharedJitter };
    });

    const result = summarizePairedRequestLatency({
      directMarkdown: pairs,
      negotiatedMarkdown: pairs,
    });

    expect(result.p95OverheadMs).toBe(3);
  });

  it('keeps rare spikes out of p95 but catches a persistent slow tail', () => {
    const rare = requestPairs(2, 30);
    const persistent = requestPairs(11, 30);

    expect(summarizePairedRequestLatency({
      directMarkdown: rare,
      negotiatedMarkdown: requestPairs(0, 0),
    }).p95OverheadMs).toBe(2);
    expect(summarizePairedRequestLatency({
      directMarkdown: persistent,
      negotiatedMarkdown: requestPairs(0, 0),
    }).p95OverheadMs).toBe(32);
  });

  it('uses the slower p95 mode and preserves the 10 ms boundary', () => {
    const exact = summarizePairedRequestLatency({
      directMarkdown: requestPairs(200, 8),
      negotiatedMarkdown: requestPairs(200, 8),
    });
    const over = summarizePairedRequestLatency({
      directMarkdown: requestPairs(200, 8.001),
      negotiatedMarkdown: requestPairs(200, 1),
    });

    expect(exact.overhead.directMarkdown.p95Ms).toBe(10);
    expect(exact.overhead.negotiatedMarkdown.p95Ms).toBe(10);
    expect(exact.p95OverheadMs).toBe(10);
    expect(over.p95OverheadMs).toBe(10.001);
  });

  it('excludes warm-up calls and alternates pair and mode order', async () => {
    const calls = [];
    const result = await measurePairedRequestLatency(async (kind) => {
      calls.push(kind);
      return calls.length <= 3 ? 100 : kind === 'html' ? 2 : 3;
    }, { pairs: 2, warmup: 1 });

    expect(calls.slice(0, 11)).toEqual([
      'html',
      'directMarkdown',
      'negotiatedMarkdown',
      'html',
      'directMarkdown',
      'html',
      'negotiatedMarkdown',
      'negotiatedMarkdown',
      'html',
      'directMarkdown',
      'html',
    ]);
    expect(result.html.maxMs).toBe(2);
    expect(result.directMarkdown.maxMs).toBe(3);
    expect(result.p95OverheadMs).toBe(1);
  });
});

function requestPairs(slowCount, slowOverhead) {
  return Array.from({ length: 200 }, (_, index) => ({
    htmlMs: 2,
    markdownMs: 4 + (index < slowCount ? slowOverhead : 0),
  }));
}
