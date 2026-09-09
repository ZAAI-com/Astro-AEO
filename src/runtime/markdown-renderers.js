// @ts-check
import {
  rendererOptions,
  validateMarkdownRendererModule,
} from '../core/markdown-renderers.js';

/**
 * @typedef {object} RuntimeMarkdownRendererLoader
 * @property {string} name
 * @property {string} module
 * @property {import('../index.js').JsonValue} [options]
 * @property {import('../index.js').CacheDeclaration} [cache]
 * @property {() => Promise<unknown>} load
 */

/** @type {WeakMap<RuntimeMarkdownRendererLoader[], Promise<import('../core/markdown-renderers.js').MarkdownRendererEntry[]>>} */
const cache = new WeakMap();

/**
 * Resolve the literal imports once per server graph. Runtime failures become a
 * renderer that diagnoses and continues, preserving ordinary project HTML and
 * the shared rendered-HTML fallback.
 * @param {RuntimeMarkdownRendererLoader[]} loaders
 */
export function loadRuntimeMarkdownRenderers(loaders) {
  let promise = cache.get(loaders);
  if (!promise) {
    promise = loadAll(loaders);
    cache.set(loaders, promise);
  }
  return promise;
}

/** @param {RuntimeMarkdownRendererLoader[]} loaders */
async function loadAll(loaders) {
  /** @type {import('../core/markdown-renderers.js').MarkdownRendererEntry[]} */
  const renderers = [];
  for (const loader of loaders) {
    try {
      const exported = await loader.load();
      const implementation = validateMarkdownRendererModule(exported, loader.module);
      if (implementation.name !== loader.name) {
        throw new TypeError(
          `preflight name was "${loader.name}" but the runtime module is "${implementation.name}"`,
        );
      }
      if (
        Boolean(implementation.cache) !== Boolean(loader.cache) ||
        (implementation.cache && loader.cache &&
          (implementation.cache.pure !== loader.cache.pure || implementation.cache.version !== loader.cache.version))
      ) {
        throw new TypeError('runtime renderer cache declaration changed after preflight');
      }
      renderers.push({
        name: implementation.name,
        module: loader.module,
        ...(loader.options === undefined
          ? {}
          : { options: rendererOptions(loader.options, `${loader.name} runtime options`) }),
        ...(implementation.cache ? { cache: implementation.cache } : {}),
        render: implementation.render,
      });
    } catch {
      const message =
        `Markdown renderer "${loader.module}" failed to load at request time; ` +
        'rendered HTML extraction was retained.';
      console.warn(`astro-aeo: ${message}`);
      renderers.push({
        name: loader.name,
        module: loader.module,
        render: () => ({
          status: 'continue',
          diagnostics: [{
            code: 'markdown-renderer-runtime-load-failed',
            severity: 'warning',
            message,
          }],
        }),
      });
    }
  }
  return renderers;
}
