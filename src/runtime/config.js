// @ts-check

/**
 * The resolved configuration, as seen at request time.
 *
 * `astro-aeo:runtime-config` has no file on disk: it is created by our own Vite
 * plugin (`src/virtual/plugin.js`) while the consumer's project is built. There
 * is therefore nothing for TypeScript to resolve, and declaring the module
 * ambiently would push that declaration into every consumer's program. So the
 * suppression is confined to this one import and everything downstream gets a
 * properly typed value.
 */

// @ts-expect-error resolved at build time by src/virtual/plugin.js
import { CATALOG_LOADERS as VIRTUAL_CATALOG_LOADERS, MARKDOWN_RENDERER_LOADERS as VIRTUAL_MARKDOWN_RENDERER_LOADERS, RUNTIME_PLUGIN_LOADERS as VIRTUAL_RUNTIME_PLUGIN_LOADERS, RUNTIME as VIRTUAL } from 'astro-aeo:runtime-config';

/** @type {import('./serve.js').Runtime} */
export const RUNTIME = VIRTUAL;

/** @type {{ module: string; load: () => Promise<import('../page.js').PageCatalog> }[]} */
export const RUNTIME_CATALOG_LOADERS = VIRTUAL_CATALOG_LOADERS;

/** @type {import('./markdown-renderers.js').RuntimeMarkdownRendererLoader[]} */
export const RUNTIME_MARKDOWN_RENDERER_LOADERS = VIRTUAL_MARKDOWN_RENDERER_LOADERS;

/** @type {import('./plugins.js').RuntimePluginLoader[]} */
export const RUNTIME_PLUGIN_LOADERS = VIRTUAL_RUNTIME_PLUGIN_LOADERS;
