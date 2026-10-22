// @ts-check

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
export function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {Record<string, any> | undefined} obj
 * @param {string} path
 * @returns {any}
 */
export function getPath(obj, path) {
  let cur = /** @type {any} */ (obj);
  for (const key of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * @param {Record<string, any>} obj
 * @param {string} path
 * @param {any} value
 * @returns {void}
 */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = /** @type {string} */ (keys.pop());
  let cur = obj;
  for (const key of keys) {
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[last] = value;
}

/**
 * @param {Record<string, any>} base
 * @param {Record<string, any>} over
 * @returns {Record<string, any>}
 */
export function deepMerge(base, over) {
  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const key of Object.keys(over)) {
    const next = over[key];
    if (next === undefined) continue;
    out[key] = isPlainObject(next) && isPlainObject(out[key]) ? deepMerge(out[key], next) : next;
  }
  return out;
}
