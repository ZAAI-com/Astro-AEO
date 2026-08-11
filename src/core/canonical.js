// @ts-check
import { headTagSources, htmlTagAttribute } from './html-head-ranges.js';
/**
 * Return a stable canonical URL or undefined. Managed graph identities may use
 * only public HTTP(S) URLs with no credentials or loopback host.
 *
 * @param {unknown} value
 * @param {string | URL | undefined} [base]
 * @returns {string | undefined}
 */
export function stableCanonical(value, base) {
  if (!(typeof value === 'string' || value instanceof URL)) return undefined;
  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password || isLoopbackHostname(url.hostname)) return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} html
 * @param {string | URL | undefined} [base]
 * @returns {{ canonical?: string; authored: string[]; conflict: boolean }}
 */
export function authoredCanonical(html, base) {
  const values = [];
  for (const tag of headTagSources(html, 'link')) {
    const rel = attribute(tag, 'rel');
    if (!rel?.split(/\s+/).some((token) => token.toLowerCase() === 'canonical')) continue;
    const href = attribute(tag, 'href');
    if (href) values.push(href);
  }
  const valid = [...new Set(values.map((value) => stableCanonical(value, base)).filter(Boolean))];
  return {
    ...(valid.length === 1 ? { canonical: valid[0] } : {}),
    authored: values,
    conflict: valid.length > 1,
  };
}

/**
 * @param {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @param {string} pathname
 * @returns {string | undefined}
 */
export function configuredCanonical(site, pathname) {
  const origin = stableCanonical(site.siteUrl);
  if (!origin) return undefined;
  const base = site.base && site.base !== '/' ? site.base.replace(/\/$/, '') : '';
  const route = pathname === '/' || site.trailingSlash === 'never' ? pathname : `${pathname}/`;
  const url = new URL(`${base}${route}`, origin);
  return stableCanonical(url);
}

/** @param {string} hostname */
export function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0'
  ) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    if (/^127(?:\.\d{1,3}){3}$/.test(mapped) || mapped === '0.0.0.0') return true;
    const groups = mapped.split(':');
    const high = Number.parseInt(groups.at(-2) ?? '', 16);
    return Number.isInteger(high) && (high >>> 8) === 127;
  }
  return false;
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  return htmlTagAttribute(tag, name);
}
