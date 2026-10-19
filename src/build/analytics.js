// @ts-check
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createJsonlSink } from '../server/analytics-node.js';
import { AeoConfigError } from '../lib/errors.js';
import { resolveCorpusTokenizerSpecifier } from './corpus-tokenizer.js';
import { toSource } from '../virtual/serialize.js';

export const ANALYTICS_MIDDLEWARE_ID = 'astro-aeo:analytics-middleware';
export const ANALYTICS_BUNDLE_SENTINEL = 'astro-aeo:enabled-request-observation-v1';
const nativeImport = /** @type {(specifier: string) => Promise<any>} */ (new Function('specifier', 'return import(specifier)'));
/** @param {string | null} adapter @param {string} command @returns {import('../analytics.js').AnalyticsSurface} */
export function analyticsSurface(adapter, command) {
  if (command === 'dev') return 'development';
  if (command === 'preview') return 'preview';
  if (adapter === '@astrojs/node') return 'node';
  if (adapter?.includes('cloudflare')) return 'cloudflare';
  if (adapter?.includes('netlify')) return 'netlify';
  if (adapter?.includes('vercel')) return 'vercel';
  if (adapter?.includes('deno')) return 'deno';
  return 'astro';
}
/** @param {import('../index.js').ResolvedAnalyticsOptions} config @param {import('../analytics.js').AnalyticsSurface} surface @param {string | null} [adapter] */
export function validateAnalyticsSurface(config, surface, adapter) {
  if (config.enabled && config.adapter.type === 'jsonl' && (!['development', 'preview', 'node'].includes(surface) || adapter?.includes('cloudflare') || (surface === 'preview' && adapter !== undefined && adapter !== '@astrojs/node'))) {
    throw new AeoConfigError('astro-aeo: analytics.adapter jsonl requires a supported Node, development, or preview surface.');
  }
}
/** Preflight modules without resolving any runtime secrets. @param {import('../index.js').ResolvedAnalyticsOptions} config @param {string} root @param {{warn(message: string): void}} logger @param {(specifier: string) => Promise<any>} [load] */
export async function preloadAnalytics(config, root, logger, load = nativeImport) {
  if (!config.enabled) return {};
  try {
    if (config.adapter.type === 'jsonl') createJsonlSink(config.adapter.path, root);
    if (config.adapter.type === 'module') {
      const specifier = resolveCorpusTokenizerSpecifier(config.adapter.module, root);
      const namespace = await load(specifier);
      if (namespace?.default?.apiVersion !== 1 || typeof namespace.default.createSink !== 'function') throw new Error();
      const sink = await namespace.default.createSink(config.adapter.options);
      if (typeof sink !== 'function') throw new Error();
      return { specifier };
    }
    if (config.adapter.type === 'opentelemetry' && !config.adapter.endpoint) {
      const require = createRequire(`${root}/package.json`);
      require.resolve('@opentelemetry/api');
    }
    return {};
  } catch {
    const message = 'astro-aeo: analytics adapter failed preflight; delivery is disabled.';
    if (config.strict) throw new AeoConfigError(message);
    logger.warn(message);
    return { failed: true };
  }
}
/** Generate only when explicitly enabled; ordinary runtime projection never refers to this module.
 * @param {() => { config: import('../index.js').ResolvedAnalyticsOptions; surface: import('../analytics.js').AnalyticsSurface; adapterName?: string | null; specifier?: string; failed?: boolean }} snapshot
 */
export function analyticsMiddlewarePlugin(snapshot) {
  return {
    name: 'astro-aeo:analytics-middleware',
    enforce: /** @type {'pre'} */ ('pre'),
    /** @param {string} id */
    resolveId(id) { return id === ANALYTICS_MIDDLEWARE_ID || id === 'astro-aeo/middleware' ? `\0${ANALYTICS_MIDDLEWARE_ID}` : undefined; },
    /** @param {string} id */
    load(id) {
      if (id !== `\0${ANALYTICS_MIDDLEWARE_ID}`) return undefined;
      const { config, surface, specifier, failed, adapterName } = snapshot();
      const local = /** @param {string} path */ (path) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
      const imports = [`import { onRequest as middleware, isInternalAeoRequest } from ${local('../runtime/middleware.js')};`,
        `import { RUNTIME } from ${local('../runtime/config.js')};`,
        `import { createAnalyticsMiddleware } from ${local('../runtime/analytics/middleware.js')};`,
        `import { createConsoleSink, createWebhookSink, createOpenTelemetrySink } from ${local('../runtime/analytics/delivery.js')};`];
      const adapter = config.adapter;
      let sink = 'createConsoleSink()';
      if (failed) sink = '() => {}';
      else if (adapter.type === 'jsonl') {
        imports.push(`import { createJsonlSink } from ${local('../server/analytics-node.js')};`);
        sink = `createJsonlSink(${JSON.stringify(adapter.path)})`;
      } else if (adapter.type === 'module') {
        if (!specifier) throw new AeoConfigError('astro-aeo: analytics module was not preflighted.');
        sink = `import(${JSON.stringify(specifier)}).then((namespace) => { const adapter = namespace.default; if (adapter?.apiVersion !== 1 || typeof adapter.createSink !== "function") throw new Error(); return adapter.createSink(${toSource(adapter.options)}); })`;
      } else if (adapter.type === 'webhook' || adapter.type === 'opentelemetry') {
        let secret = '(name) => globalThis.process?.env?.[name]';
        if (surface === 'cloudflare' || adapterName?.includes('cloudflare')) {
          imports.push('import { env } from "cloudflare:workers";');
          secret = '(name) => env[name]';
        } else if (surface === 'deno') secret = '(name) => globalThis.Deno?.env?.get(name)';
        if (adapter.type === 'webhook') sink = `createWebhookSink({ ...${toSource(adapter)}, secret: ${secret} })`;
        else if (adapter.endpoint) sink = `createOpenTelemetrySink({ ...${toSource(adapter)}, secret: ${secret} })`;
        else {
          sink = 'import("@opentelemetry/api").then(({ metrics }) => createOpenTelemetrySink({ meter: metrics.getMeter("astro-aeo", "1") }))';
        }
      }
      // Catch runtime module setup separately: sanitized, fail-closed delivery,
      // but never prevent visitor HTTP responses after a successful preflight.
      return `${imports.join('\n')}\n` +
        `const sinkReady = Promise.resolve().then(() => ${sink}).then((value) => { if (typeof value !== "function") throw new Error(); return value; }).catch(() => { console.${config.strict ? 'error' : 'warn'}("astro-aeo: analytics runtime setup failed; delivery is disabled."); return () => {}; });\n` +
        `const sink = async (event) => { const deliver = await sinkReady; await deliver(event); };\n` +
        `export const onRequest = createAnalyticsMiddleware(middleware, isInternalAeoRequest, RUNTIME, ${toSource({ ...config, surface })}, sink);\n` +
        `Object.defineProperty(onRequest, ${JSON.stringify(ANALYTICS_BUNDLE_SENTINEL)}, { value: true });\n`;
    },
  };
}
