// @ts-check

/**
 * A documentation version label such as `v2`, `2.1` or `next`. It can be spelled
 * into a public path, so it is one path segment of unreserved characters.
 */
const PAGE_VERSION = /^[A-Za-z\d][A-Za-z\d._-]{0,63}$/;

/** @param {unknown} value @returns {value is string} */
export function isPageVersion(value) {
  return typeof value === 'string' && PAGE_VERSION.test(value) && !/^\.+$/.test(value);
}
