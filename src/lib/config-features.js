// @ts-check
import { AeoConfigError } from './errors.js';
import { isPlainObject, getPath } from './config-migrate.js';
import { cloneJsonValue } from '../core/json-value.js';
import { isPageVersion } from '../core/page-version.js';

/** Validate scalar options before defaults can hide malformed input. @param {any} config */
export function validateScalarOptions(config) {
  const booleans = [
    'site.profile.enabled', 'pages.respectNoindex', 'markdown.enabled',
    'markdown.includeLastModified', 'markdown.frontmatter', 'metadata.fillMissing',
    'schema.autoInject', 'schema.strictReferences', 'schema.corpus.enabled',
    'corpus.index.enabled', 'corpus.index.includeDescriptions', 'corpus.index.showLastModified',
    'corpus.index.includeHtmlOnly', 'corpus.full.enabled', 'corpus.urlMap.enabled',
    'discovery.sitemap.alias.enabled', 'discovery.robots.enabled',
    'discovery.robots.universalAllow', 'discovery.robots.includeSitemap',
    'discovery.robots.includeLlmsTxt', 'discovery.indexNow.enabled', 'discovery.indexNow.strict',
  ];
  for (const path of booleans) {
    const value = getPath(config, path);
    if (value !== undefined && typeof value !== 'boolean') fail(path, 'must be a boolean');
  }
  for (const [path, values] of Object.entries({
    'markdown.strategy': ['auto'],
    'markdown.alternateLink': ['auto', 'always', 'never'],
    'markdown.negotiation': ['off', 'response', 'redirect'],
    'corpus.full.mode': ['all', 'index', 'first-page-only'],
    'discovery.sitemap.mode': ['auto', 'external', 'disabled'],
  })) {
    const value = getPath(config, path);
    if (value !== undefined && !values.includes(value)) fail(path, `must be one of ${values.join(', ')}`);
  }
}

/** @param {unknown} value @returns {string | undefined} */
export function resolveCacheControl(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || /[^\x20-\x7e]/.test(value)) {
    fail('markdown.cacheControl', 'must be a non-empty ASCII HTTP header value');
  }
  return /** @type {string} */ (value);
}

/** @param {unknown} input @returns {import('../index.js').ResolvedCorpusVersions | undefined} */
export function resolveCorpusVersions(input) {
  if (input === undefined) return undefined;
  const value = object(input, 'corpus.versions', ['current', 'order']);
  if (!isPageVersion(value.current)) fail('corpus.versions.current', 'must be a safe single-segment version label');
  const order = value.order === undefined ? [] : value.order;
  if (!Array.isArray(order) || order.some((item) => !isPageVersion(item)) || new Set(order).size !== order.length) {
    fail('corpus.versions.order', 'must contain unique safe single-segment version labels');
  }
  return { current: value.current, order: [...order] };
}

/** @param {unknown} input @returns {Required<import('../index.js').CorpusRagOptions>} */
export function resolveCorpusRag(input) {
  const value = object(input === undefined ? {} : input, 'corpus.rag', ['enabled', 'maxTokens', 'publish']);
  const maxTokens = value.maxTokens === undefined ? 512 : value.maxTokens;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) fail('corpus.rag.maxTokens', 'must be a positive safe integer');
  return {
    enabled: boolean(value.enabled, 'corpus.rag.enabled', false),
    maxTokens,
    publish: boolean(value.publish, 'corpus.rag.publish', false),
  };
}

/** @param {unknown} input @returns {import('../index.js').ResolvedAnalyticsOptions} */
export function resolveAnalytics(input) {
  const value = object(input === undefined ? {} : input, 'analytics', ['enabled', 'scope', 'sampleRate', 'strict', 'adapter', 'privacy']);
  const scope = value.scope === undefined ? 'agents' : value.scope;
  if (scope !== 'agents' && scope !== 'all') fail('analytics.scope', 'must be agents or all');
  const sampleRate = value.sampleRate === undefined ? 1 : value.sampleRate;
  if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    fail('analytics.sampleRate', 'must be a finite number between 0 and 1');
  }
  const privacy = object(value.privacy === undefined ? {} : value.privacy, 'analytics.privacy', ['ip', 'query', 'referrer']);
  for (const key of ['ip', 'query', 'referrer']) {
    if (privacy[key] !== undefined && privacy[key] !== 'omit') fail(`analytics.privacy.${key}`, 'must be omit');
  }
  const adapter = resolveAdapter(value.adapter);
  return {
    enabled: boolean(value.enabled, 'analytics.enabled', false),
    scope, sampleRate,
    strict: boolean(value.strict, 'analytics.strict', false),
    adapter,
    privacy: { ip: 'omit', query: 'omit', referrer: 'omit' },
  };
}

/** @param {unknown} input @returns {import('../index.js').AnalyticsAdapter} */
function resolveAdapter(input) {
  const path = 'analytics.adapter';
  const value = object(input === undefined ? { type: 'console' } : input, path);
  const keys = /** @type {Record<string, string[]>} */ ({
    console: ['type'], jsonl: ['type', 'path'], webhook: ['type', 'url', 'headers'],
    opentelemetry: ['type', 'endpoint', 'headers'], module: ['type', 'module', 'options'],
  });
  if (typeof value.type !== 'string' || !Object.hasOwn(keys, value.type)) fail(`${path}.type`, 'must be console, jsonl, webhook, opentelemetry, or module');
  object(value, path, keys[value.type]);
  if (value.type === 'console') return { type: 'console' };
  if (value.type === 'jsonl') {
    const filename = value.path === undefined ? '.astro/aeo-analytics/events-v1.jsonl' : value.path;
    if (typeof filename !== 'string' || !filename || /[\x00-\x1f]/.test(filename)) fail(`${path}.path`, 'must be a non-empty file path');
    return { type: 'jsonl', path: filename };
  }
  if (value.type === 'module') {
    const specifier = value.module instanceof URL ? value.module.href : value.module;
    if (typeof specifier !== 'string' || !specifier.trim() || /[\x00-\x1f]/.test(specifier) ||
      (/^[a-z][a-z\d+.-]*:/i.test(specifier) && !specifier.startsWith('file:'))) {
      fail(`${path}.module`, 'must be a local module specifier or file URL');
    }
    let options;
    try { options = value.options === undefined ? undefined : cloneJsonValue(value.options, `${path}.options`); }
    catch { fail(`${path}.options`, 'must be strict JSON'); }
    return { type: 'module', module: specifier, ...(options === undefined ? {} : { options }) };
  }
  const field = value.type === 'webhook' ? 'url' : 'endpoint';
  const endpoint = value[field];
  if (value.type === 'webhook' || endpoint !== undefined) {
    try {
      const url = new URL(endpoint);
      if (typeof endpoint !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    } catch { fail(`${path}.${field}`, 'must be an HTTPS URL without credentials or fragment'); }
  }
  const headers = value.headers === undefined ? undefined : object(value.headers, `${path}.headers`);
  /** @type {Record<string, import('../index.js').AnalyticsRuntimeSecret>} */
  const references = {};
  for (const [name, raw] of Object.entries(headers ?? {})) {
    if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name)) fail(`${path}.headers`, 'contains an invalid header name');
    const secret = object(raw, `${path}.headers.${name}`, ['env', 'prefix']);
    if (typeof secret.env !== 'string' || !/^[A-Za-z_][A-Za-z_\d]*$/.test(secret.env)) fail(`${path}.headers.${name}.env`, 'must be an environment variable name');
    if (secret.prefix !== undefined && (typeof secret.prefix !== 'string' || /[^\x20-\x7e]/.test(secret.prefix))) fail(`${path}.headers.${name}.prefix`, 'must be an ASCII header prefix');
    references[name] = { env: secret.env, ...(secret.prefix === undefined ? {} : { prefix: secret.prefix }) };
  }
  return /** @type {import('../index.js').AnalyticsAdapter} */ ({ type: value.type,
    ...(endpoint === undefined ? {} : { [field]: endpoint }), ...(headers === undefined ? {} : { headers: references }) });
}

/** @param {unknown} input @param {string} path @param {string[]} [keys] @returns {Record<string, any>} */
function object(input, path, keys) {
  if (!isPlainObject(input)) fail(path, 'must be an object');
  const value = /** @type {Record<string, any>} */ (input);
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'is not supported');
  return value;
}
/** @param {unknown} value @param {string} path @param {boolean} fallback */
function boolean(value, path, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return /** @type {boolean} */ (value);
}
/** @param {string} path @param {string} message @returns {never} */
function fail(path, message) { throw new AeoConfigError(`astro-aeo: ${path} ${message}.`); }
