// @ts-check
import { isPlainObject } from '../lib/config-migrate.js';

/**
 * Emitting the resolved config as JavaScript source, for the virtual module the
 * runtime imports.
 *
 * `JSON.stringify` is not enough: the config legitimately contains regular
 * expressions (`pages.stripTitleSuffix`) and sets, which it would turn into `{}`
 * without complaint. It also contains functions (`corpus.index.sections[].match`)
 * which cannot cross into a bundle at all, and silently dropping those is exactly
 * the class of bug this release exists to remove. So they are found and reported
 * first, then omitted deliberately.
 */

/**
 * Find every value that cannot be serialized, as dotted paths.
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
 * Render a value as JavaScript source.
 *
 * Functions are omitted rather than approximated: there is no expression that
 * reconstructs a closure. Callers are expected to have warned already, via
 * `findNonSerializable`, so the omission is never the user's first news of it.
 *
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
      // A key whose value is a function is dropped entirely rather than emitted
      // as `undefined`, so the runtime sees an absent option, not a null one.
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
    'They still apply during `astro build` and `astro dev`. At request time the rule is skipped, ' +
    'so a page it would have matched falls through to the default. Use a glob or a regular expression to apply it everywhere.'
  );
}
