// @ts-check

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate and clone a strict, acyclic JSON value. The returned value has no
 * accessors or caller-owned mutable containers, which makes it safe to freeze
 * and carry into build or runtime plugin code.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {import('../index.js').JsonValue}
 */
export function cloneJsonValue(value, label = 'value') {
  return clone(value, label, new Set());
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<object>} seen
 * @returns {import('../index.js').JsonValue}
 */
function clone(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} must contain only finite JSON numbers.`);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must be a strict JSON value.`);
  }

  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(`${path} must not contain sparse arrays.`);
        }
        output.push(clone(value[index], `${path}[${index}]`, seen));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects.`);
    }

    /** @type {Record<string, import('../index.js').JsonValue>} */
    const output = Object.create(null);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new TypeError(`${path} contains forbidden key "${key}".`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new TypeError(`${path}.${key} must not be an accessor.`);
      }
      output[key] = clone(descriptor.value, `${path}.${key}`, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

/**
 * Clone and recursively freeze JSON data.
 * @param {unknown} value
 * @param {string} [label]
 * @returns {import('../index.js').JsonValue}
 */
export function immutableJsonValue(value, label) {
  return deepFreeze(cloneJsonValue(value, label));
}

/** @template T @param {T} value @returns {T} */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
