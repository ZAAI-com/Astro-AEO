// @ts-check

/**
 * Astro's Node adapter builds a request's URL from its `Host` header only when that
 * host matches `security.allowedDomains` (Astro 6, and Astro 7.4 or newer). Any other
 * request reaches the app as `localhost`, which the runtime correctly refuses to
 * treat as the configured site. These helpers decide which configured hostnames the
 * project has not allowed, so the build can name them before a deploy returns 404.
 *
 * Hostname matching mirrors Astro's `matchHostname` with wildcards enabled: an entry
 * without a hostname allows every host, `*.example.com` allows exactly one subdomain
 * level, and `**.example.com` allows any depth of subdomain but not the apex. Protocol
 * and port are ignored, so a partially matching entry never produces a false warning.
 */

/**
 * @param {string} hostname
 * @param {string | undefined} pattern
 * @returns {boolean}
 */
function matchesHostname(hostname, pattern) {
  if (!pattern) return true;
  const candidate = pattern.toLowerCase();
  if (candidate.startsWith('**.')) {
    const suffix = candidate.slice(2);
    return hostname !== suffix.slice(1) && hostname.endsWith(suffix);
  }
  if (candidate.startsWith('*.')) {
    const suffix = candidate.slice(1);
    if (!hostname.endsWith(suffix)) return false;
    const label = hostname.slice(0, -suffix.length);
    return label.length > 0 && !label.includes('.');
  }
  return candidate === hostname;
}

/**
 * @param {string} hostname
 * @param {unknown} allowedDomains
 * @returns {boolean}
 */
export function isHostnameAllowed(hostname, allowedDomains) {
  if (!Array.isArray(allowedDomains)) return false;
  const normalized = hostname.toLowerCase();
  return allowedDomains.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const pattern = /** @type {{ hostname?: unknown }} */ (entry).hostname;
    if (pattern !== undefined && typeof pattern !== 'string') return false;
    return matchesHostname(normalized, pattern);
  });
}

/**
 * Hostnames of `origins` that no `allowedDomains` entry covers, deduplicated in
 * first-seen order. Unparseable origins are skipped.
 * @param {Iterable<string>} origins
 * @param {unknown} allowedDomains
 * @returns {string[]}
 */
export function hostnamesMissingFromAllowedDomains(origins, allowedDomains) {
  /** @type {string[]} */
  const missing = [];
  for (const origin of origins) {
    let hostname;
    try {
      hostname = new URL(origin).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!hostname || missing.includes(hostname)) continue;
    if (!isHostnameAllowed(hostname, allowedDomains)) missing.push(hostname);
  }
  return missing;
}

/**
 * @param {string[]} hostnames
 * @returns {string}
 */
export function allowedDomainsWarning(hostnames) {
  const entries = hostnames.map((hostname) => `{ hostname: '${hostname}' }`).join(', ');
  return (
    `astro-aeo: the Node adapter keeps a request's Host header only for domains listed in ` +
    `security.allowedDomains (Astro 6, and Astro 7.4 or newer). ${hostnames.join(', ')} ` +
    `${hostnames.length === 1 ? 'is' : 'are'} not listed, so requests for ` +
    `${hostnames.length === 1 ? 'it' : 'them'} reach the server as localhost and llms.txt, ` +
    'llms-full.txt and the corpus paths answer 404. Add this to your Astro config ' +
    '(it also lets Astro trust matching X-Forwarded-Host values from your proxy):\n\n' +
    `  security: { allowedDomains: [${entries}] },\n`
  );
}
