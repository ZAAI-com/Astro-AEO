// @ts-check
import { toSource } from './serialize.js';

export const RUNTIME_CONFIG_ID = 'astro-aeo:runtime-config';
const RESOLVED_ID = `\0${RUNTIME_CONFIG_ID}`;

/**
 * A Vite plugin that hands the resolved config to the runtime.
 *
 * `addMiddleware` takes an entrypoint module, not a closure, so the config has to
 * cross a module boundary. The alternatives do not work: `astro:env` only carries
 * strings, numbers, booleans and enums; a module-level variable is invisible
 * because the integration runs in Node while the runtime module runs in Vite's SSR
 * graph and is bundled separately at build time.
 *
 * `load()` runs lazily, on first import, which is after `astro:config:done`. That
 * is why the snapshot is read through a callback rather than captured here: the
 * site facts do not exist yet when the plugin is registered.
 *
 * Typed structurally rather than against `import('vite').Plugin`: Vite is Astro's
 * dependency, not ours, and this package should not acquire a type dependency on
 * it to describe four fields.
 *
 * @param {() => Record<string, unknown>} getSnapshot
 * @returns {{ name: string; enforce: 'pre'; resolveId(id: string): string | undefined; load(id: string): string | undefined }}
 */
export function aeoRuntimeConfigPlugin(getSnapshot) {
  return {
    name: 'astro-aeo:runtime-config',
    enforce: 'pre',
    /** @param {string} id */
    resolveId(id) {
      return id === RUNTIME_CONFIG_ID ? RESOLVED_ID : undefined;
    },
    /** @param {string} id */
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      return `export const RUNTIME = ${toSource(getSnapshot())};\nexport default RUNTIME;\n`;
    },
  };
}
