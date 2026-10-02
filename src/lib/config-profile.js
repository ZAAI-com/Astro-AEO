// @ts-check
import { AeoConfigError } from './errors.js';
import { isPlainObject } from './config-migrate.js';

/** Per-origin profile values inherit the shared profile, never its enablement.
 * @param {unknown} input
 * @returns {Record<string, import('../index.js').DomainProfileOverride>}
 */
export function resolveProfileOrigins(input) {
  if (input === undefined) return {};
  if (!isPlainObject(input)) throw new AeoConfigError('astro-aeo: site.profile.origins must be an origin-keyed object.');
  const allowed = new Set(['name', 'description', 'website', 'email', 'logo', 'sameAs', 'entityType']);
  const entityTypes = new Set(['Organization', 'Person', 'Blog', 'NGO', 'Community', 'Project',
    'CreativeWork', 'SoftwareApplication', 'Thing']);
  /** @type {Record<string, import('../index.js').DomainProfileOverride>} */
  const origins = {};
  for (const [rawOrigin, values] of Object.entries(/** @type {Record<string, unknown>} */ (input))) {
    const path = `site.profile.origins[${JSON.stringify(rawOrigin)}]`;
    let origin;
    try {
      const url = new URL(rawOrigin);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) throw new TypeError();
      origin = url.origin;
    } catch { throw new AeoConfigError(`astro-aeo: ${path} must name an HTTP(S) origin without credentials, a path, query or fragment.`); }
    if (origins[origin]) throw new AeoConfigError(`astro-aeo: ${path} duplicates a normalized origin.`);
    if (!isPlainObject(values)) throw new AeoConfigError(`astro-aeo: ${path} must be a profile override object.`);
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (values))) {
      if (!allowed.has(key)) throw new AeoConfigError(`astro-aeo: ${path}.${key} is not a supported profile override.`);
      if (key === 'sameAs' ? !Array.isArray(value) || value.some((item) => typeof item !== 'string') : typeof value !== 'string') {
        throw new AeoConfigError(`astro-aeo: ${path}.${key} must be ${key === 'sameAs' ? 'an array of strings' : 'a string'}.`);
      }
      if (key === 'entityType' && !entityTypes.has(/** @type {string} */ (value))) {
        throw new AeoConfigError(`astro-aeo: ${path}.entityType must be a supported profile entity type.`);
      }
    }
    origins[origin] = { .../** @type {import('../index.js').DomainProfileOverride} */ (values),
      ...(Array.isArray(/** @type {any} */ (values).sameAs) ? { sameAs: [.../** @type {any} */ (values).sameAs] } : {}) };
  }
  return origins;
}
