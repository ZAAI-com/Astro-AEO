import { test, expect, vi } from 'vitest';
import { createConsoleSink, createWebhookSink, createOpenTelemetrySink, createAnalytics, ANALYTICS_CONSOLE_MARKER } from '../../analytics.js';
const event = { version: 1, type: 'request', path: '/secret-path', timestamp: '2026-10-03T12:00:00.000Z',
  crawler: { identity: 'GPTBot', classification: 'claimed' }, representation: 'html', surface: 'node', status: 200,
  method: 'GET', scope: 'agents', sampleRate: 0.5 };

test('console uses a versioned machine-readable marker', () => {
  const logger = { log: vi.fn() }; createConsoleSink(logger)(event);
  expect(logger.log).toHaveBeenCalledWith(`${ANALYTICS_CONSOLE_MARKER}${JSON.stringify(event)}`);
});
test.each(['http://example.com', 'https://user:password@example.com', 'https://example.com/#secret'])('rejects unsafe delivery endpoint %s', (url) => {
  expect(() => createWebhookSink({ url })).toThrow(); expect(() => createOpenTelemetrySink({ endpoint: url })).toThrow();
});
test('webhook resolves secrets per delivery, sends one-event envelopes and a bounded nonredirecting request', async () => {
  let credential = 'runtime-first'; const secret = vi.fn(() => credential); const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const sink = createWebhookSink({ url: 'https://events.example.test/ingest', headers: { authorization: { env: 'EVENT_KEY', prefix: 'Bearer ' } }, secret, fetch });
  expect(secret).not.toHaveBeenCalled(); await sink(event); credential = 'runtime-next'; await sink(event);
  expect(secret).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toBe('https://events.example.test/ingest'); expect(init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit' });
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(JSON.parse(init.body)).toEqual({ version: 1, events: [event] });
  }
  expect(fetch.mock.calls[0][1].headers.get('authorization')).toBe('Bearer runtime-first');
  expect(fetch.mock.calls[1][1].headers.get('authorization')).toBe('Bearer runtime-next');
});
test.each([301, 302, 307, 400, 500])('rejects redirect and delivery status %s', async (status) => {
  await expect(createWebhookSink({ url: 'https://example.test', fetch: async () => new Response(null, { status }) })(event)).rejects.toThrow('rejected');
});
test('missing secret fails without issuing a request or echoing its name', async () => {
  const fetch = vi.fn(); const sink = createWebhookSink({ url: 'https://example.test', headers: { authorization: { env: 'PRIVATE_KEY' } }, fetch });
  await expect(sink(event)).rejects.toThrow('runtime secret is unavailable'); expect(fetch).not.toHaveBeenCalled();
});
test('webhook timeout signal aborts at two seconds and HTTP observation stays caught', async () => {
  vi.useFakeTimers();
  // Node AbortSignal.timeout uses its native clock: capture its declared delay.
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const sink = createWebhookSink({ url: 'https://example.test', fetch: async () => { throw new Error('network-secret'); } });
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  const observer = createAnalytics({ enabled: true, scope: 'all', sink, logger });
  const original = new Response('same'); expect(observer.observe(new Request('https://site.test/'), original)).toBe(original);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(timeout).toHaveBeenCalledWith(2000); timeout.mockRestore(); vi.useRealTimers();
});
test('optional-peer counters use bounded attributes and never path or timestamp attributes', async () => {
  const add = vi.fn(); const createCounter = vi.fn(() => ({ add })); await createOpenTelemetrySink({ meter: { createCounter } })(event);
  expect(createCounter).toHaveBeenCalledWith('astro_aeo.requests'); expect(add.mock.calls[0][0]).toBe(1);
  expect(add.mock.calls[0][1]).toMatchObject({ crawler: 'GPTBot', sample_rate: 0.5 });
  expect(JSON.stringify(add.mock.calls)).not.toContain('secret-path'); expect(add.mock.calls[0][1]).not.toHaveProperty('timestamp');
});
test('OTLP HTTP JSON emits a delta counter without path attributes', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  await createOpenTelemetrySink({ endpoint: 'https://otel.test/v1/metrics', clock: () => 123456, fetch })(event);
  const body = JSON.parse(fetch.mock.calls[0][1].body); const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
  expect(metric.name).toBe('astro_aeo.requests'); expect(metric.sum).toMatchObject({ aggregationTemporality: 1, isMonotonic: true });
  expect(metric.sum.dataPoints[0]).toMatchObject({ asInt: '1', timeUnixNano: '123456000000' });
  expect(JSON.stringify(body)).not.toContain('secret-path');
});
