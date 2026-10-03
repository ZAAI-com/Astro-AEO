// @ts-check
export const ANALYTICS_CONSOLE_MARKER = 'astro-aeo:analytics-v1 ';
/** @param {Pick<Console, 'log'>} [logger] @returns {import('../../analytics.js').AnalyticsSink} */
export function createConsoleSink(logger = console) { return (event) => { logger.log(`${ANALYTICS_CONSOLE_MARKER}${JSON.stringify(event)}`); }; }
/** @param {{ url: string; headers?: Record<string, import('../../index.js').AnalyticsRuntimeSecret>; secret?: (name: string) => string | undefined; fetch?: typeof fetch }} options @returns {import('../../analytics.js').AnalyticsSink} */
export function createWebhookSink(options) {
  httpsUrl(options.url);
  return async (event) => {
    await post(options.url, { version: 1, events: [event] }, options);
  };
}
/** @param {{ meter?: { createCounter(name: string): { add(value: number, attributes: Record<string, string | number>): void } }; endpoint?: string; headers?: Record<string, import('../../index.js').AnalyticsRuntimeSecret>; secret?: (name: string) => string | undefined; fetch?: typeof fetch; clock?: () => number }} options @returns {import('../../analytics.js').AnalyticsSink} */
export function createOpenTelemetrySink(options) {
  if (options.meter) {
    const counter = options.meter.createCounter('astro_aeo.requests');
    return (event) => { counter.add(1, attributes(event)); };
  }
  if (!options.endpoint) throw new TypeError('astro-aeo: OpenTelemetry requires an optional-peer meter or an HTTPS OTLP endpoint');
  httpsUrl(options.endpoint);
  return async (event) => {
    const time = String(BigInt(Math.trunc((options.clock ?? Date.now)())) * 1000000n);
    const values = attributes(event);
    await post(/** @type {string} */ (options.endpoint), { resourceMetrics: [{ scopeMetrics: [{ scope: { name: 'astro-aeo', version: '1' }, metrics: [{
      name: 'astro_aeo.requests', sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: [{ startTimeUnixNano: time, timeUnixNano: time, asInt: '1',
        attributes: Object.entries(values).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value } })) }] },
    }] }] }] }, options);
  };
}
/** @param {import('../../analytics.js').AnalyticsEventV1} event */
function attributes(event) { return { crawler: event.crawler.identity, classification: event.crawler.classification, representation: event.representation,
  surface: event.surface, status: event.status, method: event.method, scope: event.scope, sample_rate: event.sampleRate }; }
/** @param {string} value */
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('astro-aeo: analytics delivery requires an HTTPS URL without credentials or fragment');
}
/** @param {string} url @param {unknown} body @param {{ headers?: Record<string, import('../../index.js').AnalyticsRuntimeSecret>; secret?: (name: string) => string | undefined; fetch?: typeof fetch }} options */
async function post(url, body, options) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [name, reference] of Object.entries(options.headers ?? {})) {
    const secret = options.secret?.(reference.env);
    if (!secret) throw new Error('astro-aeo: analytics runtime secret is unavailable');
    headers.set(name, `${reference.prefix ?? ''}${secret}`);
  }
  // Content type is a protocol requirement, not a secret-overridable header.
  headers.set('content-type', 'application/json');
  const response = await (options.fetch ?? globalThis.fetch)(url, { method: 'POST', headers, body: JSON.stringify(body),
    redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(2000) });
  // Delivery responses are not visitor responses, and need not retain a body.
  void response.body?.cancel().catch(() => {});
  if (!response.ok || response.status >= 300) throw new Error('astro-aeo: analytics delivery was rejected');
}
