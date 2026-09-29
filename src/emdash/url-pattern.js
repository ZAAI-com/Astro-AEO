// @ts-check

/**
 * EmDash collection URL patterns, resolved the way EmDash resolves them for its
 * own sitemap and menus: `{slug}` and `{id}` are URI-encoded, date tokens come
 * from the publish date in UTC, repeated slashes collapse, and a trailing slash
 * is dropped. Unlike EmDash, a token that cannot be resolved yields `null`
 * instead of a literal `{year}` in a public URL.
 */

const REPEATED_SLASHES = /\/{2,}/g;
const DATE_TOKENS = /\{(year|month|day|hour|minute|second)\}/g;
const ANY_TOKEN = /\{[^{}]*\}/;
// SQLite stores UTC datetimes without an offset ("2026-05-08 10:00:00").
const OFFSETLESS_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** @param {number} value */
const pad2 = (value) => String(value).padStart(2, '0');

/**
 * @param {string | Date | null | undefined} value
 * @returns {Date | null}
 */
export function parseEmDashDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const offsetless = OFFSETLESS_DATETIME.exec(value);
  const date = new Date(offsetless ? `${offsetless[1]}T${offsetless[2]}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {{ pattern: string; slug: string; id?: string; date?: string | Date | null }} options
 * @returns {string | null} a root-relative path, or null when a token has no value.
 */
export function interpolateUrlPattern({ pattern, slug, id, date }) {
  let path = pattern.replaceAll('{slug}', encodeURIComponent(slug));
  if (path.includes('{id}')) {
    if (!id) return null;
    path = path.replaceAll('{id}', encodeURIComponent(id));
  }
  if (path.search(DATE_TOKENS) !== -1) {
    const parsed = parseEmDashDate(date);
    if (!parsed) return null;
    /** @type {Record<string, string>} */
    const parts = {
      year: String(parsed.getUTCFullYear()),
      month: pad2(parsed.getUTCMonth() + 1),
      day: pad2(parsed.getUTCDate()),
      hour: pad2(parsed.getUTCHours()),
      minute: pad2(parsed.getUTCMinutes()),
      second: pad2(parsed.getUTCSeconds()),
    };
    path = path.replace(DATE_TOKENS, (match, key) => parts[key] ?? match);
  }
  if (ANY_TOKEN.test(path)) return null;
  path = path.replace(REPEATED_SLASHES, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

/**
 * The glob matching every URL a pattern can produce, from its literal prefix:
 * `/posts/{slug}` is `/posts/**`. A pattern that starts with a token, such as
 * `/{slug}`, shares its URLs with the rest of the site and has no glob.
 *
 * @param {string} pattern
 * @returns {string | null}
 */
export function urlPatternGlob(pattern) {
  const tokenAt = pattern.search(ANY_TOKEN);
  const literal = tokenAt === -1 ? pattern : pattern.slice(0, tokenAt);
  const segments = literal.split('/').filter(Boolean);
  // A partial segment ("/posts-{slug}") is not a directory the glob can name.
  if (tokenAt !== -1 && !literal.endsWith('/')) segments.pop();
  if (segments.length === 0) return null;
  return `/${segments.join('/')}/**`;
}
