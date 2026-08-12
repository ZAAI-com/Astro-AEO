// @ts-check
import { CRAWLER_REGISTRY, crawlerRegistryEntry } from '../crawler-registry.js';

/**
 * The robots.txt body. Pure, so the build and the runtime emit the same text.
 */

/**
 * Build the robots.txt body from config.
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl  Site origin without trailing slash.
 * @param {string} [base]   Astro base path (e.g. "" or "/docs"); prefixed onto
 *                          the Sitemap and llms.txt URLs, which deploy under it.
 * @param {boolean} [sitemapAvailable]  Whether the configured sitemap should be
 *                          advertised. The late build finalizer verifies static
 *                          output; explicit config may force runtime sitemaps.
 * @param {boolean} [llmsAvailable] Whether an accepted root llms.txt claim exists.
 * @returns {string}
 */
export function buildRobotsTxt(
  config,
  siteUrl,
  base = '',
  sitemapAvailable = true,
  llmsAvailable = config.corpus.index.enabled,
) {
  const robots = config.discovery.robots;
  const policy = robots.policy ?? 'custom';
  if (policy === 'custom') {
    return appendContentSignals(
      buildCustomRobotsTxt(config, siteUrl, base, sitemapAvailable, llmsAvailable),
      robots.contentSignals,
    );
  }
  return buildPresetRobotsTxt(config, siteUrl, base, sitemapAvailable, llmsAvailable, policy);
}

/**
 * The 1.2 renderer is intentionally kept as its own path. With no Content
 * Signals, every newline and ordering decision remains byte-for-byte identical.
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl
 * @param {string} base
 * @param {boolean} sitemapAvailable
 * @param {boolean} llmsAvailable
 */
function buildCustomRobotsTxt(config, siteUrl, base, sitemapAvailable, llmsAvailable) {
  const { universalAllow, allow, disallow, includeSitemap, sitemapPath, includeLlmsTxt, extraLines } = config.discovery.robots;
  const b = base && base !== '/' ? base.replace(/\/$/, '') : '';
  const lines = [];

  // Lead with an explicit open policy for unlisted crawlers, unless the user
  // opted out or already declared a "*" group in allow/disallow/extraLines
  // (which would duplicate it).
  const hasWildcard =
    allow.includes('*') ||
    disallow.includes('*') ||
    extraLines.some((line) => /^user-agent:\s*\*(?:\s|$)/i.test(line.trim()));
  if (universalAllow && !hasWildcard) lines.push('User-agent: *', 'Allow: /', '');

  for (const bot of allow) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  for (const bot of disallow) lines.push(`User-agent: ${bot}`, 'Disallow: /', '');

  if (includeSitemap && sitemapAvailable && siteUrl) lines.push(`Sitemap: ${siteUrl}${b}${sitemapPath}`);
  if (includeLlmsTxt && llmsAvailable && siteUrl) {
    // Not a standard robots directive; emitted as a comment as a hint for
    // humans and crawlers. Primary discovery is the per-page alternate link.
    lines.push(`# llms.txt: ${siteUrl}${b}/llms.txt`);
  }
  for (const extra of extraLines) lines.push(extra);

  return `${lines.join('\n')}\n`;
}

/**
 * Render an RFC 9309 group policy from a frozen registry plus explicit token
 * overrides. `extraLines` deliberately remains an unparsed escape hatch.
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteUrl
 * @param {string} base
 * @param {boolean} sitemapAvailable
 * @param {boolean} llmsAvailable
 * @param {string} policy
 */
function buildPresetRobotsTxt(config, siteUrl, base, sitemapAvailable, llmsAvailable, policy) {
  const robots = config.discovery.robots;
  if (!['open', 'search-open-training-closed', 'retrieval-only', 'closed'].includes(policy)) {
    throw new TypeError(`astro-aeo: unsupported robots policy "${policy}"`);
  }

  const allow = normalizeOverrides(robots.allow ?? [], 'allow');
  const disallow = normalizeOverrides(robots.disallow ?? [], 'disallow');
  for (const key of allow.keys()) {
    if (disallow.has(key)) {
      throw new TypeError(`astro-aeo: robots allow and disallow overlap for "${allow.get(key)}"`);
    }
  }

  const wildcardOverride = allow.has('*') ? 'allow' : disallow.has('*') ? 'disallow' : undefined;
  allow.delete('*');
  disallow.delete('*');
  const wildcardAction = wildcardOverride ?? (policy === 'open' || policy === 'search-open-training-closed'
    ? 'allow'
    : 'disallow');
  const lines = ['User-agent: *', wildcardAction === 'allow' ? 'Allow: /' : 'Disallow: /', ''];

  const knownKeys = new Set(CRAWLER_REGISTRY.map((value) => value.token.toLowerCase()));
  for (const crawler of CRAWLER_REGISTRY) {
    const key = crawler.token.toLowerCase();
    const override = allow.has(key) ? 'allow' : disallow.has(key) ? 'disallow' : undefined;
    const action = override ?? presetException(policy, crawler.purposes);
    if (!action || (action === wildcardAction && !override)) continue;
    lines.push(`User-agent: ${crawler.token}`, action === 'allow' ? 'Allow: /' : 'Disallow: /', '');
  }

  const unknown = [...allow.entries(), ...disallow.entries()]
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, token]) => ({ key, token, action: allow.has(key) ? 'allow' : 'disallow' }))
    .sort((a, b) => codeUnitCompare(a.token, b.token));
  for (const item of unknown) {
    lines.push(`User-agent: ${item.token}`, item.action === 'allow' ? 'Allow: /' : 'Disallow: /', '');
  }

  const b = base && base !== '/' ? base.replace(/\/$/, '') : '';
  if (robots.includeSitemap && sitemapAvailable && siteUrl) {
    lines.push(`Sitemap: ${siteUrl}${b}${robots.sitemapPath}`);
  }
  if (robots.includeLlmsTxt && llmsAvailable && siteUrl) {
    lines.push(`# llms.txt: ${siteUrl}${b}/llms.txt`);
  }
  for (const extra of robots.extraLines ?? []) lines.push(extra);

  return appendContentSignals(`${lines.join('\n')}\n`, robots.contentSignals);
}

/**
 * @param {string} policy
 * @param {readonly string[]} purposes
 * @returns {'allow'|'disallow'|undefined}
 */
function presetException(policy, purposes) {
  if (policy === 'search-open-training-closed' && purposes.includes('training')) return 'disallow';
  if (
    policy === 'retrieval-only' &&
    !purposes.includes('training') &&
    (purposes.includes('search') || purposes.includes('user-retrieval'))
  ) {
    return 'allow';
  }
  return undefined;
}

/** @param {readonly string[]} values @param {string} name */
function normalizeOverrides(values, name) {
  /** @type {Map<string, string>} */
  const result = new Map();
  for (const raw of values) {
    if (typeof raw !== 'string' || !raw || /[\u0000-\u0020\u007f]/u.test(raw)) {
      throw new TypeError(`astro-aeo: discovery.robots.${name} contains an unsafe crawler token`);
    }
    const known = crawlerRegistryEntry(raw);
    const token = known?.token ?? raw;
    const key = token.toLowerCase();
    if (!result.has(key)) result.set(key, token);
  }
  return result;
}

/**
 * @param {string} body
 * @param {{ search?: boolean; aiInput?: boolean; aiTrain?: boolean } | undefined} signals
 */
function appendContentSignals(body, signals) {
  if (
    !signals ||
    typeof signals.search !== 'boolean' ||
    typeof signals.aiInput !== 'boolean' ||
    typeof signals.aiTrain !== 'boolean'
  ) {
    return body;
  }
  const value = [
    `search=${signals.search ? 'yes' : 'no'}`,
    `ai-input=${signals.aiInput ? 'yes' : 'no'}`,
    `ai-train=${signals.aiTrain ? 'yes' : 'no'}`,
  ].join(', ');
  return `${body}# Experimental Content Signals, not part of RFC 9309\nContent-Signal: ${value}\n`;
}

/** @param {string} a @param {string} b */
function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
