// @ts-check

/**
 * A recovered exception is not page loss. Exception values never cross this boundary.
 * @param {string} plugin
 * @param {string} stage
 * @param {string} [pathname]
 * @returns {import('../index.js').Diagnostic}
 */
export function recoveredHookDiagnostic(plugin, stage, pathname) {
  const safeName = plugin.replace(/[^A-Za-z0-9._:@/-]/g, '-').slice(0, 100);
  return {
    version: 1, code: 'plugin-hook-recovered', severity: 'warning',
    message: `Plugin "${safeName}" threw during ${stage}; the last valid value was retained.`,
    ...(pathname ? { pathname } : {}),
    details: { plugin: safeName, stage },
  };
}
