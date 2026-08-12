// @ts-check

/**
 * Frozen crawler-policy facts captured for the 1.3 release. This registry is
 * intentionally data, not live documentation lookup: robots.txt generation
 * must be reproducible and must never depend on network access.
 *
 * @typedef {'crawler'|'user-triggered'|'control-token'} CrawlerTokenKind
 * @typedef {'search'|'user-retrieval'|'training'} CrawlerPurpose
 * @typedef {{
 *   token: string;
 *   kind: CrawlerTokenKind;
 *   operator: string;
 *   purposes: readonly CrawlerPurpose[];
 *   documentationUrl: string;
 *   verifiedAt: '2026-08-12';
 * }} CrawlerRegistryEntry
 */

const VERIFIED_AT = '2026-08-12';

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
 * @returns {CrawlerRegistryEntry}
 */
function entry(token, kind, operator, purposes, documentationUrl) {
  return Object.freeze({
    token,
    kind,
    operator,
    purposes: Object.freeze(purposes),
    documentationUrl,
    verifiedAt: VERIFIED_AT,
  });
}
