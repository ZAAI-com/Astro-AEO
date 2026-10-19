// @ts-check
import { ANALYTICS_CRAWLER_REGISTRY, CRAWLER_REGISTRY_VERSION } from '../../core/crawler-registry.js';
import { inspectRootPathname } from '../../core/match.js';
import { createConsoleSink } from './delivery.js';

const IDENTITIES = ANALYTICS_CRAWLER_REGISTRY.map(({ token }) => ({ token,
  expression: new RegExp(`(?:^|[^a-z0-9-])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9-])`, 'i') }));
const SURFACES = new Set(['development', 'preview', 'node', 'deno', 'astro', 'cloudflare', 'netlify', 'vercel']);
/** @param {string | null} userAgent @returns {import('../../analytics.js').AnalyticsEventV1['crawler']} */
export function classifyCrawler(userAgent) {
  // Bound work as well as output. Never retain or deliver the original value.
  const matched = typeof userAgent === 'string' && userAgent.length <= 4096
    ? IDENTITIES.find(({ expression }) => expression.test(userAgent)) : undefined;
  return Object.freeze({ identity: matched ? matched.token : 'unknown', classification: matched ? 'claimed' : 'unclassified' });
}
/** @param {import('../../analytics.js').AnalyticsObserverOptions} [options] @returns {import('../../analytics.js').AnalyticsObserver} */
export function createAnalytics(options = {}) {
  if (options.enabled !== true) return { observe: (_request, response) => response };
  if (options.sink !== undefined && typeof options.sink !== 'function') throw new TypeError('astro-aeo: analytics sink must be a function');
  if (!options.sink && options.adapter && options.adapter.type !== 'console') throw new TypeError('astro-aeo: non-console analytics requires an explicitly injected sink');
  const rate = options.sampleRate ?? 1;
  const scope = options.scope ?? 'agents';
  if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !['agents', 'all'].includes(scope)) throw new TypeError('astro-aeo: invalid analytics sampling configuration');
  if (options.privacy && Object.entries(options.privacy).some(([key, value]) => !['ip', 'query', 'referrer'].includes(key) || value !== 'omit')) throw new TypeError('astro-aeo: analytics privacy must omit identifying data');
  const base = (options.base ?? '').replace(/\/$/, '');
  const inventory = pathIndex(options.inventory);
  const artifacts = pathIndex(options.artifacts);
  const patterns = (options.patterns ?? []).filter(({ routePattern }) => safePath(routePattern));
  const logger = options.logger ?? console;
  const sink = options.sink ?? createConsoleSink(logger);
  let failed = false;
  /** @param {unknown} _error */
  function failure(_error) {
    if (failed) return;
    failed = true;
    // The thrown value can contain credentials, paths or raw requests.
    try { logger[options.strict ? 'error' : 'warn']('astro-aeo: analytics delivery failed; request response is unchanged.'); } catch { /* Logging cannot change HTTP. */ }
  }
  return {
    observe(request, response, details = {}) {
      try {
        if (details.internal || details.prerendered || rate === 0 || !['GET', 'HEAD'].includes(request.method)) return response;
        const pathname = details.pathname ?? new URL(request.url).pathname;
        if (!safePath(pathname) || (base && pathname !== base && !pathname.startsWith(`${base}/`))) return response;
        let path = '(unlisted)';
        /** @type {import('../../analytics.js').AnalyticsEventV1['pathKind']} */
        let pathKind = 'unlisted';
        const artifact = artifacts().get(key(pathname));
        const known = inventory().get(key(pathname));
        if (artifact) { path = artifact; pathKind = 'artifact'; }
        else if (known) { path = known; pathKind = 'inventory'; }
        else for (const record of patterns) {
          // Do not mutate caller-owned stateful regexes.
          if (new RegExp(record.pattern.source, record.pattern.flags.replace(/[gy]/g, '')).test(pathname)) {
            path = record.routePattern; pathKind = record.artifact ? 'artifact' : 'pattern'; break;
          }
        }
        const userAgent = request.headers.get('user-agent');
        if (userAgent === 'astro-aeo-internal/1') return response;
        const crawler = classifyCrawler(userAgent);
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (scope === 'agents' && pathKind !== 'artifact' && contentType !== 'text/markdown' &&
          (crawler.classification !== 'claimed' || contentType !== 'text/html')) return response;
        if (rate < 1) {
          const random = (options.random ?? Math.random)();
          if (!Number.isFinite(random) || random < 0 || random >= rate) return response;
        }
        const now = (options.clock ?? Date.now)();
        const surface = details.surface ?? options.surface ?? 'astro';
        if (!SURFACES.has(surface)) throw new TypeError('Invalid analytics surface');
        const representation = details.representation ?? (response.status >= 300 && response.status < 400 && response.status !== 304 ? 'redirect'
          : contentType === 'text/markdown' ? 'markdown' : pathKind === 'artifact' ? 'artifact'
            : contentType === 'text/html' ? 'html' : 'other');
        if (!['html', 'markdown', 'artifact', 'redirect', 'other'].includes(representation)) throw new TypeError('Invalid analytics representation');
        /** @type {import('../../analytics.js').AnalyticsEventV1} */
        const event = Object.freeze({ version: 1, type: 'request', timestamp: new Date(Math.floor(now / 60000) * 60000).toISOString(),
          registryVersion: CRAWLER_REGISTRY_VERSION, method: /** @type {'GET'|'HEAD'} */ (request.method),
          status: response.status, path, pathKind, crawler, representation,
          cache: response.status === 304 ? 'not-modified' : 'unknown', surface, sampleRate: rate, scope, coverage: 'observable-only' });
        const work = Promise.resolve().then(() => sink(event)).catch(failure);
        if (details.waitUntil) { try { details.waitUntil(work); } catch (error) { failure(error); } }
        else void work;
      } catch (error) { failure(error); }
      return response;
    },
  };
}
/** @param {string} path */
function safePath(path) { return typeof path === 'string' && path.length <= 2048 && !/[?#\x00-\x1f\x7f]/.test(path) && inspectRootPathname(path) !== null; }
/** @param {string} path */
function key(path) { return path.length > 1 ? path.replace(/\/$/, '') : path; }

/** Rebuild indexes only when a safely held inventory changes.
 * @param {readonly string[] | (() => readonly string[]) | undefined} source
 */
function pathIndex(source) {
  /** @type {readonly string[] | undefined} */
  let previous;
  /** @type {Map<string, string>} */
  let index = new Map();
  return () => {
    const paths = typeof source === 'function' ? source() : source;
    if (paths !== previous) {
      previous = paths;
      index = new Map((paths ?? []).flatMap((path) => safePath(path) ? [[key(path), path]] : []));
    }
    return index;
  };
}
