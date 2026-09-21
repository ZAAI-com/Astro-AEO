// @ts-check

/**
 * The immutable rule registry. Every code that the validator CLI, the build
 * diagnostics, the sitemap validator or the schema graph validator can emit is
 * listed here under its published spelling: a 1.4 `ruleId` is the pre-1.4
 * `code` verbatim, so existing JSON consumers and documentation keep working.
 *
 * `severity` is the severity the rule normally carries. A finding keeps the
 * severity its emitter chose, which can differ (a few rules are configurable).
 *
 * @typedef {import('../index.js').AuditCategory} AuditCategory
 * @typedef {import('../index.js').Finding['severity']} Severity
 * @typedef {'build' | 'offline' | 'live'} RuleApplicability
 * @typedef {object} AuditRule
 * @property {string} ruleId
 * @property {AuditCategory} category
 * @property {Severity} severity
 * @property {string} helpUrl
 * @property {readonly RuleApplicability[]} applicability
 */

export const HELP_BASE_URL = 'https://github.com/ZAAI-com/Astro-AEO/blob/main/docs/rules.md';

/** Category order is part of the report contract: reports list them in this order. */
export const AUDIT_CATEGORIES = /** @type {readonly AuditCategory[]} */ (Object.freeze([
  'discovery',
  'metadata',
  'markdown',
  'corpus',
  'structured-data',
  'internationalization',
  'links',
  'build',
]));

/**
 * @param {AuditCategory} category
 * @param {Severity} severity
 * @param {RuleApplicability[]} applicability
 * @param {string[]} ruleIds
 * @returns {AuditRule[]}
 */
function rules(category, severity, applicability, ruleIds) {
  const frozenApplicability = Object.freeze([...applicability]);
  return ruleIds.map((ruleId) => Object.freeze({
    ruleId,
    category,
    severity,
    helpUrl: helpUrlFor(ruleId),
    applicability: frozenApplicability,
  }));
}

/** @type {readonly AuditRule[]} */
const RULE_LIST = Object.freeze([
  ...rules('markdown', 'info', ['build'], ['authored-source-fallback']),
  ...rules('build', 'warning', ['build'], ['catalog-invalid-version']),
  // Rules the 1.4 audit adds. Everything below them predates it.
  ...rules('links', 'error', ['offline', 'live'], ['link-internal-broken']),
  ...rules('links', 'warning', ['offline', 'live'], ['link-anchor-missing']),
  ...rules('metadata', 'warning', ['build', 'offline', 'live'], [
    'canonical-duplicate', 'description-duplicate', 'description-missing', 'title-duplicate',
  ]),
  ...rules('markdown', 'error', ['build', 'offline', 'live'], ['markdown-empty']),
  ...rules('markdown', 'warning', ['build', 'offline', 'live'], [
    'markdown-html-residue', 'markdown-no-h1', 'markdown-thin',
  ]),
  ...rules('internationalization', 'error', ['offline', 'live'], ['hreflang-target-missing']),
  ...rules('internationalization', 'warning', ['offline', 'live'], [
    'hreflang-return-missing', 'html-lang-missing',
  ]),
  ...rules('discovery', 'error', ['live'], ['live-fetch-failed', 'live-target-unreachable']),
  ...rules('discovery', 'warning', ['live'], [
    'live-body-too-large', 'live-markdown-mime', 'live-page-cap-reached', 'live-redirect-limit',
  ]),
  ...rules('discovery', 'info', ['live'], ['live-external-skipped']),
  ...rules('links', 'error', ['offline'], ['corpus-link-missing']),
  ...rules('metadata', 'warning', ['build'], ['metadata-conflict', 'metadata-duplicate']),
  ...rules('corpus', 'warning', ['build'], [
    'small-corpus-first-block-omitted', 'small-corpus-truncated',
  ]),
  ...rules('build', 'error', ['build'], [
    'artifact-commit-failed', 'artifact-generated-conflict', 'artifact-invalid-destination',
    'artifact-invalid-pathname', 'artifact-invalid-replacement-path',
    'artifact-invalid-representation', 'artifact-redaction-failed', 'plugin-artifact-missing',
    'plugin-build-complete-isolated', 'plugin-html-delta-conflict',
  ]),
  ...rules('build', 'info', ['build'], [
    'artifact-external-owner-replaced',
  ]),
  ...rules('build', 'warning', ['build'], [
    'artifact-external-owner-preserved', 'artifact-group-skipped',
    'catalog-foreign-origin-companion', 'catalog-invalid-date', 'catalog-invalid-last-modified',
    'catalog-invalid-origin', 'catalog-invalid-pathname', 'catalog-load-failed',
    'catalog-missing-list-pages', 'catalog-owned-artifact-excluded', 'catalog-path-conflict',
    'catalog-unconfigured-origin', 'catalog-unsupported-module-format',
    'prerendered-custom-404-negotiation', 'processing-cache-invalid',
    'processing-cache-lock-unavailable',
  ]),
  ...rules('corpus', 'error', ['build'], [
    'corpus-manifest-canonical-missing', 'corpus-manifest-origin-missing',
  ]),
  ...rules('corpus', 'error', ['offline'], [
    'corpus-alias-content', 'corpus-alias-source-missing', 'corpus-artifact-duplicate',
    'corpus-artifact-hash', 'corpus-artifact-missing', 'corpus-artifact-no-h1',
    'corpus-artifact-read', 'corpus-artifact-shape', 'corpus-artifact-source',
    'corpus-artifact-source-missing', 'corpus-artifact-source-tokens', 'corpus-artifact-tokens',
    'corpus-artifact-utf8', 'corpus-chunk-fence', 'corpus-gzip-content', 'corpus-gzip-invalid',
    'corpus-gzip-metadata', 'corpus-gzip-source-missing', 'corpus-manifest-base',
    'corpus-manifest-format', 'corpus-manifest-json', 'corpus-manifest-read',
    'corpus-manifest-self-reference', 'corpus-manifest-shape', 'corpus-page-chunk-metadata',
    'corpus-page-chunk-missing', 'corpus-page-duplicate', 'corpus-page-hash',
    'corpus-page-markdown-missing', 'corpus-page-markdown-url', 'corpus-page-markdown-utf8',
    'corpus-page-shape', 'corpus-page-tokens', 'corpus-tokenizer-identity',
  ]),
  ...rules('corpus', 'warning', ['build'], [
    'corpus-chunk-over-budget', 'corpus-manifest-skipped', 'corpus-tokenizer-fallback',
    'corpus-tokenizer-load-failed', 'small-corpus-preamble-over-budget',
    'small-corpus-wrapper-omitted',
  ]),
  ...rules('corpus', 'warning', ['offline'], [
    'corpus-artifact-empty', 'corpus-chunk-unreferenced',
  ]),
  ...rules('discovery', 'error', ['build'], [
    'indexnow-site-required', 'indexnow-state-unavailable',
  ]),
  ...rules('discovery', 'error', ['offline'], [
    'dp-invalid-json', 'dp-missing-field', 'llms-no-h1', 'no-dist', 'no-html',
    'robots-corpus-missing', 'robots-corpus-url-invalid', 'robots-sitemap-outside-base',
    'robots-sitemap-url-invalid', 'sitemap-canonical-mismatch', 'sitemap-index-cycle',
    'sitemap-index-empty', 'sitemap-index-loc-invalid', 'sitemap-mixed-content',
    'sitemap-namespace-invalid', 'sitemap-path-invalid', 'sitemap-read-failed',
    'sitemap-reference-duplicate', 'sitemap-reference-escape', 'sitemap-reference-missing',
    'sitemap-reference-not-local', 'sitemap-root-invalid', 'sitemap-route-missing',
    'sitemap-url-alias', 'sitemap-url-duplicate', 'sitemap-url-invalid',
    'sitemap-url-loc-invalid', 'sitemap-url-origin', 'sitemap-urlset-empty',
    'sitemap-xml-malformed',
  ]),
  ...rules('discovery', 'warning', ['build'], [
    'dynamic-routes-unindexed', 'indexnow-inventory-incomplete', 'indexnow-state-mode-adjusted',
    'indexnow-state-read-only', 'url-map-existing-output', 'url-map-public-file',
  ]),
  ...rules('discovery', 'warning', ['build', 'offline'], [
    'no-llms', 'no-llms-full',
  ]),
  ...rules('discovery', 'warning', ['offline'], [
    'dp-relative-url', 'empty-llms-full', 'llms-empty', 'llms-full-separators',
    'llms-multiple-h1', 'robots-corpus-external', 'robots-no-wildcard', 'robots-relative-sitemap',
    'robots-sitemap-duplicate', 'robots-unknown-line', 'sitemap-external-unchecked',
  ]),
  ...rules('internationalization', 'error', ['build'], [
    'corpus-locale-required',
  ]),
  ...rules('internationalization', 'error', ['offline'], [
    'corpus-locale-canonical-missing', 'corpus-locale-canonical-order', 'corpus-locale-duplicate',
    'corpus-locale-shape', 'corpus-page-locale-missing', 'sitemap-hreflang-canonical-mismatch',
    'sitemap-hreflang-duplicate', 'sitemap-hreflang-invalid', 'sitemap-hreflang-not-reciprocal',
    'sitemap-hreflang-target-missing', 'sitemap-hreflang-url-invalid',
  ]),
  ...rules('internationalization', 'warning', ['build'], [
    'aeo-head-locale-invalid',
  ]),
  ...rules('markdown', 'error', ['offline'], [
    'img-missing-alt', 'missing-md',
  ]),
  ...rules('markdown', 'warning', ['build'], [
    'defuddle-failed', 'defuddle-invalid-options', 'defuddle-no-content',
    'markdown-renderer-duplicate-name', 'markdown-renderer-load-failed',
    'markdown-renderer-runtime-load-failed', 'mdx-invalid-component-mapping', 'mdx-parse-failed',
    'mdx-rendered-html-fallback', 'page-html-unreadable',
  ]),
  ...rules('markdown', 'warning', ['offline'], [
    'duplicate-alternate-link', 'no-alternate-link', 'orphan-md',
  ]),
  ...rules('metadata', 'error', ['build'], [
    'aeo-head-invalid', 'aeo-head-multiple',
  ]),
  ...rules('metadata', 'warning', ['build'], [
    'canonical-conflict', 'canonical-invalid', 'managed-head-missing',
  ]),
  ...rules('metadata', 'warning', ['offline'], [
    'og-description-length', 'og-image-missing', 'og-image-relative', 'og-title-length',
    'robots-meta-missing', 'title-length', 'twitter-card-type',
  ]),
  ...rules('structured-data', 'error', ['build'], [
    'managed-graph-invalid', 'plugin-graph-inconsistent', 'schema-corpus-canonical-missing',
    'schema-corpus-invalid', 'schema-corpus-late-semantic-change', 'schema.duplicate-role',
    'schema.invalid-graph', 'schema.invalid-id', 'schema.invalid-known-id',
    'schema.invalid-known-ids', 'schema.invalid-reference', 'schema.invalid-validation-url',
    'schema.relative-url-base-missing', 'schema.scalar-conflict', 'schema.unresolved-reference',
    'schema.unsafe-url',
  ]),
  ...rules('structured-data', 'warning', ['build'], [
    'authored-jsonld-invalid', 'authored-jsonld-malformed', 'managed-graph-canonical-missing',
    'plugin-graph-validation', 'schema-map-anonymous-entity', 'schema.scalar-conflict-resolved',
  ]),
]);

/** @type {ReadonlyMap<string, AuditRule>} */
const RULES = new Map(RULE_LIST.map((rule) => [rule.ruleId, rule]));

if (RULES.size !== RULE_LIST.length) {
  throw new Error('astro-aeo: the audit rule registry lists a ruleId more than once');
}

/** @param {string} ruleId */
export function helpUrlFor(ruleId) {
  // GitHub drops dots when it derives a heading anchor, so `schema.*` ids lose theirs.
  return `${HELP_BASE_URL}#${ruleId.replaceAll('.', '')}`;
}

/** @param {string} ruleId @returns {AuditRule | undefined} */
export function getRule(ruleId) {
  return RULES.get(ruleId);
}

/** Every registered rule, in registry order. */
export function listRules() {
  return RULE_LIST;
}

/**
 * Category for a code. A code outside the registry (a plugin's own diagnostic,
 * for example) is reported under `build` instead of being dropped.
 *
 * @param {string} ruleId
 * @returns {AuditCategory}
 */
export function categoryFor(ruleId) {
  return RULES.get(ruleId)?.category ?? 'build';
}
