// @ts-check
import { inspectRootPathname } from '../../src/core/match.js';
import { assertContract } from './contracts.js';
import { MAX_BYTES, MAX_ROWS, ReportInvocationError } from './io.js';

/** Date-only filters are UTC midnight; full timestamps must be explicit UTC.
 * @param {string|undefined} value */
export function utcFilter(value) {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.000Z)?$/.test(value)) throw new ReportInvocationError('Date filters must be YYYY-MM-DD or an explicit UTC timestamp.');
  const expanded = value.length === 10 ? value + 'T00:00:00.000Z' : value;
  if (!Number.isFinite(Date.parse(expanded)) || new Date(expanded).toISOString() !== expanded) throw new ReportInvocationError('Invalid UTC date filter.');
  return expanded;
}

/** Accept only JSONL or exactly marked observation lines; console chatter is not data.
 * @param {string} text @param {{from?:string;to?:string;weighted?:boolean;bucket?:'minute'|'day'}} [options]
 * @returns {import('../../src/index.js').AnalyticsReportV1} */
export function trafficReport(text, options = {}) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new ReportInvocationError('Report input exceeds the byte limit.');
  const from = utcFilter(options.from), to = utcFilter(options.to);
  if (from && to && from >= to) throw new ReportInvocationError('--from must precede --to.');
  const weighted = options.weighted === true;
  /** @type {import('../../src/analytics.js').AnalyticsEventV1[]} */
  const events = [];
  let rows = 0;
  const lines = text.split(/\r?\n/);
  const consoleInput = lines.some((line) => line.startsWith('astro-aeo:analytics-v1 '));
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (!line.trim()) continue;
    if (consoleInput && !line.startsWith('astro-aeo:analytics-v1 ')) continue;
    if (line.startsWith('astro-aeo:analytics-v1 ')) line = line.slice('astro-aeo:analytics-v1 '.length);
    if (++rows > MAX_ROWS || Buffer.byteLength(line) > 65536) throw new ReportInvocationError('Traffic input exceeds the row or line limit.');
    let event;
    try { event = JSON.parse(line); assertContract(event,'analytics-event-v1'); if (event.path !== '(unlisted)' && !inspectRootPathname(event.path)) throw new Error(); }
    catch { throw new ReportInvocationError('Invalid traffic event on line ' + (index + 1) + '.'); }
    if ((event.pathKind === 'unlisted') !== (event.path === '(unlisted)') ||
      (event.crawler.classification === 'unclassified') !== (event.crawler.identity === 'unknown')) throw new ReportInvocationError('Inconsistent traffic event on line ' + (index + 1) + '.');
    if ((!from || event.timestamp >= from) && (!to || event.timestamp < to)) events.push(event);
  }
  const unique = (/** @type {(e: any) => string|number} */ select) => [...new Set(events.map(select))].sort();
  /** @param {(e: any) => string} select */
  const group = (select) => {
    /** @type {Map<string, {key:string;observed:number;estimated?:number}>} */
    const groups = new Map();
    for (const event of events) {
      const key = select(event), entry = groups.get(key) ?? { key, observed: 0, ...(weighted ? {estimated:0} : {}) };
      entry.observed++;
      if (weighted) entry.estimated = (entry.estimated ?? 0) + 1 / event.sampleRate;
      groups.set(key,entry);
    }
    if ([...groups.values()].some((item) => item.estimated !== undefined && !Number.isFinite(item.estimated))) throw new ReportInvocationError('Weighted estimates exceed the finite numeric range.');
    return [...groups.values()].sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
  const estimated = events.reduce((sum,event) => sum + 1 / event.sampleRate,0);
  if (weighted && !Number.isFinite(estimated)) throw new ReportInvocationError('Weighted estimates exceed the finite numeric range.');
  return {
    version: 1, type: 'traffic', warnings: [
      'Counts are observed events, not verified crawler visits or full-site traffic.',
      ...(weighted ? ['Weighted estimates assume the recorded sampling probabilities; coverage gaps are not estimated.'] : []),
      ...(!events.length ? ['No matching observations were available.'] : []),
    ], observed: events.length, ...(weighted ? {estimated} : {}),
    filters: {from,to},
    disclosure: {coverage:'observable-only', classification:'claimed',
      sampleRates: /** @type {number[]} */ (unique((e) => e.sampleRate)).sort((a,b) => a-b),
      scopes: /** @type {Array<'agents'|'all'>} */ (unique((e) => e.scope)),
      surfaces: /** @type {string[]} */ (unique((e) => e.surface)), registryVersions: /** @type {string[]} */ (unique((e) => e.registryVersion)),
      weighted, estimateBasis:'inverse-probability-not-verified-traffic'},
    buckets: group((e) => options.bucket === 'minute' ? e.timestamp : e.timestamp.slice(0,10)),
    paths: group((e) => e.path), crawlers: group((e) => e.crawler.identity),
    representations: group((e) => e.representation), statuses: group((e) => String(e.status)),
  };
}
