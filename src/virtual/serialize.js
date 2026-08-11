// @ts-check
import { isPlainObject } from '../lib/config-migrate.js';

/**
 * Keep build-only sitemap callbacks out of the runtime snapshot without
 * mutating the resolved configuration used by the build integration.
 *
 * @template T
 * @param {T & { discovery: { sitemap: object } }} config
 * @returns {T}
 */
export function runtimeConfigProjection(config) {
  const { plugins: _plugins, ...runtimeConfig } = /** @type {any} */ (config);
  return /** @type {T} */ ({
    ...runtimeConfig,
    markdown: {
      .../** @type {any} */ (config).markdown,
      // Renderer functions travel through validated literal module loaders.
      // Inline functions are build-only and never enter the runtime snapshot.
      renderers: [],
    },
    discovery: {
      ...config.discovery,
      sitemap: {
        ...config.discovery.sitemap,
        options: {},
      },
    },
  });
}

/**
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function findNonSerializable(value, path = '') {
  if (typeof value === 'function') return [path || '(root)'];
  if (value === null || typeof value !== 'object') return [];
  if (value instanceof RegExp || value instanceof Date) return [];
  if (value instanceof Set || value instanceof Map) {
    return [...value].flatMap((entry, i) => findNonSerializable(entry, `${path}[${i}]`));
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => findNonSerializable(entry, `${path}[${i}]`));
  }
  if (!isPlainObject(value)) return [path || '(root)'];
  return Object.keys(value).flatMap((key) =>
    findNonSerializable(value[key], path ? `${path}.${key}` : key),
  );
}

/**
 * @param {unknown} value
 * @returns {string} JavaScript source, or `undefined` for an omitted value.
 */
export function toSource(value) {
  if (typeof value === 'function') return 'undefined';
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof RegExp) return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`;
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  if (value instanceof Set) return `new Set(${toSource([...value])})`;
  if (value instanceof Map) return `new Map(${toSource([...value])})`;
  if (Array.isArray(value)) return `[${value.map(toSource).join(', ')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => typeof value[key] !== 'function' && value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}: ${toSource(value[key])}`);
    return `{ ${entries.join(', ')} }`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json;
}

/**
 * The warning text for options that cannot reach the runtime.
 * @param {string[]} paths
 * @returns {string}
 */
export function nonSerializableWarning(paths) {
  return (
    `astro-aeo: these options cannot be used at request time because they are functions: ${paths.join(', ')}. ` +
    'They still apply during `astro build`, but are skipped in `astro dev` and at request time, ' +
    'so a page they would have matched falls through to the default. Use a glob or a regular expression to apply them everywhere.'
  );
}
