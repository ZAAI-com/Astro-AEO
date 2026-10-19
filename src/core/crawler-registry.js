// @ts-check

/**
 * Frozen crawler-policy facts captured for the 1.3 release and extended in
 * 1.5.1. This registry is intentionally data, not live documentation lookup:
 * robots.txt generation must be reproducible and must never depend on network
 * access. Only tokens their operator documents first-party belong here.
 *
 * @typedef {'crawler'|'user-triggered'|'control-token'} CrawlerTokenKind
 * @typedef {'search'|'user-retrieval'|'training'} CrawlerPurpose
 * @typedef {{
 *   token: string;
 *   kind: CrawlerTokenKind;
 *   operator: string;
 *   purposes: readonly CrawlerPurpose[];
 *   documentationUrl: string;
 *   verifiedAt: string;
 * }} CrawlerRegistryEntry
 */

export const CRAWLER_REGISTRY_VERSION = '2';

const VERIFIED_AT_1_3 = '2026-08-12';
const VERIFIED_AT_1_5_1 = '2026-09-29';

/** @type {readonly CrawlerRegistryEntry[]} */
export const CRAWLER_REGISTRY = Object.freeze([
  entry('OAI-SearchBot', 'crawler', 'OpenAI', ['search'], 'https://developers.openai.com/api/docs/bots'),
  entry('GPTBot', 'crawler', 'OpenAI', ['training'], 'https://developers.openai.com/api/docs/bots'),
  entry('ChatGPT-User', 'user-triggered', 'OpenAI', ['user-retrieval'], 'https://developers.openai.com/api/docs/bots'),
  entry('ClaudeBot', 'crawler', 'Anthropic', ['training'], 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'),
  entry('Claude-SearchBot', 'crawler', 'Anthropic', ['search'], 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'),
  entry('Claude-User', 'user-triggered', 'Anthropic', ['user-retrieval'], 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'),
  entry('PerplexityBot', 'crawler', 'Perplexity', ['search'], 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers'),
  entry('Perplexity-User', 'user-triggered', 'Perplexity', ['user-retrieval'], 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers'),
  entry('Googlebot', 'crawler', 'Google', ['search'], 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers'),
  entry('Google-Extended', 'control-token', 'Google', ['user-retrieval', 'training'], 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers'),
  entry('bingbot', 'crawler', 'Microsoft', ['search'], 'https://www.bing.com/webmasters/help/help/which-crawlers-does-bing-use-8c184ec0'),
  entry('Applebot-Extended', 'control-token', 'Apple', ['training'], 'https://support.apple.com/en-us/119829', VERIFIED_AT_1_5_1),
  entry('Meta-ExternalAgent', 'crawler', 'Meta', ['training'], 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/', VERIFIED_AT_1_5_1),
  entry('Amazonbot', 'crawler', 'Amazon', ['training'], 'https://developer.amazon.com/amazonbot', VERIFIED_AT_1_5_1),
  entry('CCBot', 'crawler', 'Common Crawl', ['training'], 'https://commoncrawl.org/ccbot', VERIFIED_AT_1_5_1),
]);

/** Observable identities only. Policy-only tokens never classify a User-Agent.
 * Keeping this separate preserves the default robots policy and ordering.
 * These tokens are claims, not proof of operator identity.
 * @type {readonly CrawlerRegistryEntry[]}
 */
export const ANALYTICS_CRAWLER_REGISTRY = Object.freeze([
  ...CRAWLER_REGISTRY.filter((value) => value.kind !== 'control-token'),
  entry('Applebot', 'crawler', 'Apple', ['search', 'training'], 'https://support.apple.com/en-us/119829', '2026-10-03'),
  entry('Amzn-SearchBot', 'crawler', 'Amazon', ['search'], 'https://developer.amazon.com/amazonbot', '2026-10-03'),
  entry('Amzn-User', 'user-triggered', 'Amazon', ['user-retrieval'], 'https://developer.amazon.com/amazonbot', '2026-10-03'),
]);

/** @type {ReadonlyMap<string, CrawlerRegistryEntry>} */
const BY_TOKEN = new Map(CRAWLER_REGISTRY.map((value) => [value.token.toLowerCase(), value]));

/**
 * Look up a registry token without making user-agent spelling significant.
 * @param {string} token
 * @returns {CrawlerRegistryEntry | undefined}
 */
export function crawlerRegistryEntry(token) {
  return BY_TOKEN.get(token.toLowerCase());
}

/**
 * @param {string} token
 * @param {CrawlerTokenKind} kind
 * @param {string} operator
 * @param {CrawlerPurpose[]} purposes
 * @param {string} documentationUrl
 * @param {string} [verifiedAt]
 * @returns {CrawlerRegistryEntry}
 */
function entry(token, kind, operator, purposes, documentationUrl, verifiedAt = VERIFIED_AT_1_3) {
  return Object.freeze({
    token,
    kind,
    operator,
    purposes: Object.freeze(purposes),
    documentationUrl,
    verifiedAt,
  });
}
