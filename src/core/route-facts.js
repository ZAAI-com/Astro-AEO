// @ts-check

/** Match public route mechanics without carrying props or module content.
 * @param {string} pathname
 * @param {readonly { pattern: RegExp; routePattern: string }[]} [routes]
 */
export function routePatternFor(pathname, routes = []) {
  for (const route of routes) {
    route.pattern.lastIndex = 0;
    if (route.pattern.test(pathname)) return route.routePattern;
  }
  return undefined;
}
