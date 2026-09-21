# Astro-AEO rules

Generated from `src/audit/rules.js` by `node scripts/generate-rule-docs.mjs`. Do not edit by hand.

A rule ID is the `code` of a build diagnostic or validator finding, and the `ruleId` of an audit
finding. The severity shown is the usual one: a few rules are configurable, and a finding always
reports the severity it was actually raised with.

## Category: discovery

### dp-invalid-json

Severity: error. Raised by: offline.

### dp-missing-field

Severity: error. Raised by: offline.

### dp-relative-url

Severity: warning. Raised by: offline.

### dynamic-routes-unindexed

Severity: warning. Raised by: build.

### empty-llms-full

Severity: warning. Raised by: offline.

### indexnow-inventory-incomplete

Severity: warning. Raised by: build.

### indexnow-site-required

Severity: error. Raised by: build.

### indexnow-state-mode-adjusted

Severity: warning. Raised by: build.

### indexnow-state-read-only

Severity: warning. Raised by: build.

### indexnow-state-unavailable

Severity: error. Raised by: build.

### llms-empty

Severity: warning. Raised by: offline.

### llms-full-separators

Severity: warning. Raised by: offline.

### llms-multiple-h1

Severity: warning. Raised by: offline.

### llms-no-h1

Severity: error. Raised by: offline.

### no-dist

Severity: error. Raised by: offline.

### no-html

Severity: error. Raised by: offline.

### no-llms

Severity: warning. Raised by: build, offline.

### no-llms-full

Severity: warning. Raised by: build, offline.

### robots-corpus-external

Severity: warning. Raised by: offline.

### robots-corpus-missing

Severity: error. Raised by: offline.

### robots-corpus-url-invalid

Severity: error. Raised by: offline.

### robots-no-wildcard

Severity: warning. Raised by: offline.

### robots-relative-sitemap

Severity: warning. Raised by: offline.

### robots-sitemap-duplicate

Severity: warning. Raised by: offline.

### robots-sitemap-outside-base

Severity: error. Raised by: offline.

### robots-sitemap-url-invalid

Severity: error. Raised by: offline.

### robots-unknown-line

Severity: warning. Raised by: offline.

### sitemap-canonical-mismatch

Severity: error. Raised by: offline.

### sitemap-external-unchecked

Severity: warning. Raised by: offline.

### sitemap-index-cycle

Severity: error. Raised by: offline.

### sitemap-index-empty

Severity: error. Raised by: offline.

### sitemap-index-loc-invalid

Severity: error. Raised by: offline.

### sitemap-mixed-content

Severity: error. Raised by: offline.

### sitemap-namespace-invalid

Severity: error. Raised by: offline.

### sitemap-path-invalid

Severity: error. Raised by: offline.

### sitemap-read-failed

Severity: error. Raised by: offline.

### sitemap-reference-duplicate

Severity: error. Raised by: offline.

### sitemap-reference-escape

Severity: error. Raised by: offline.

### sitemap-reference-missing

Severity: error. Raised by: offline.

### sitemap-reference-not-local

Severity: error. Raised by: offline.

### sitemap-root-invalid

Severity: error. Raised by: offline.

### sitemap-route-missing

Severity: error. Raised by: offline.

### sitemap-url-alias

Severity: error. Raised by: offline.

### sitemap-url-duplicate

Severity: error. Raised by: offline.

### sitemap-url-invalid

Severity: error. Raised by: offline.

### sitemap-url-loc-invalid

Severity: error. Raised by: offline.

### sitemap-url-origin

Severity: error. Raised by: offline.

### sitemap-urlset-empty

Severity: error. Raised by: offline.

### sitemap-xml-malformed

Severity: error. Raised by: offline.

### url-map-existing-output

Severity: warning. Raised by: build.

### url-map-public-file

Severity: warning. Raised by: build.

## Category: metadata

### aeo-head-invalid

Severity: error. Raised by: build.

### aeo-head-multiple

Severity: error. Raised by: build.

### canonical-conflict

Severity: warning. Raised by: build.

### canonical-invalid

Severity: warning. Raised by: build.

### managed-head-missing

Severity: warning. Raised by: build.

### metadata-conflict

Severity: warning. Raised by: build.

### metadata-duplicate

Severity: warning. Raised by: build.

### og-description-length

Severity: warning. Raised by: offline.

### og-image-missing

Severity: warning. Raised by: offline.

### og-image-relative

Severity: warning. Raised by: offline.

### og-title-length

Severity: warning. Raised by: offline.

### robots-meta-missing

Severity: warning. Raised by: offline.

### title-length

Severity: warning. Raised by: offline.

### twitter-card-type

Severity: warning. Raised by: offline.

## Category: markdown

### defuddle-failed

Severity: warning. Raised by: build.

### defuddle-invalid-options

Severity: warning. Raised by: build.

### defuddle-no-content

Severity: warning. Raised by: build.

### duplicate-alternate-link

Severity: warning. Raised by: offline.

### img-missing-alt

Severity: error. Raised by: offline.

### markdown-renderer-duplicate-name

Severity: warning. Raised by: build.

### markdown-renderer-load-failed

Severity: warning. Raised by: build.

### markdown-renderer-runtime-load-failed

Severity: warning. Raised by: build.

### mdx-invalid-component-mapping

Severity: warning. Raised by: build.

### mdx-parse-failed

Severity: warning. Raised by: build.

### mdx-rendered-html-fallback

Severity: warning. Raised by: build.

### missing-md

Severity: error. Raised by: offline.

### no-alternate-link

Severity: warning. Raised by: offline.

### orphan-md

Severity: warning. Raised by: offline.

### page-html-unreadable

Severity: warning. Raised by: build.

## Category: corpus

### corpus-alias-content

Severity: error. Raised by: offline.

### corpus-alias-source-missing

Severity: error. Raised by: offline.

### corpus-artifact-duplicate

Severity: error. Raised by: offline.

### corpus-artifact-empty

Severity: warning. Raised by: offline.

### corpus-artifact-hash

Severity: error. Raised by: offline.

### corpus-artifact-missing

Severity: error. Raised by: offline.

### corpus-artifact-no-h1

Severity: error. Raised by: offline.

### corpus-artifact-read

Severity: error. Raised by: offline.

### corpus-artifact-shape

Severity: error. Raised by: offline.

### corpus-artifact-source

Severity: error. Raised by: offline.

### corpus-artifact-source-missing

Severity: error. Raised by: offline.

### corpus-artifact-source-tokens

Severity: error. Raised by: offline.

### corpus-artifact-tokens

Severity: error. Raised by: offline.

### corpus-artifact-utf8

Severity: error. Raised by: offline.

### corpus-chunk-fence

Severity: error. Raised by: offline.

### corpus-chunk-over-budget

Severity: warning. Raised by: build.

### corpus-chunk-unreferenced

Severity: warning. Raised by: offline.

### corpus-gzip-content

Severity: error. Raised by: offline.

### corpus-gzip-invalid

Severity: error. Raised by: offline.

### corpus-gzip-metadata

Severity: error. Raised by: offline.

### corpus-gzip-source-missing

Severity: error. Raised by: offline.

### corpus-manifest-base

Severity: error. Raised by: offline.

### corpus-manifest-canonical-missing

Severity: error. Raised by: build.

### corpus-manifest-format

Severity: error. Raised by: offline.

### corpus-manifest-json

Severity: error. Raised by: offline.

### corpus-manifest-origin-missing

Severity: error. Raised by: build.

### corpus-manifest-read

Severity: error. Raised by: offline.

### corpus-manifest-self-reference

Severity: error. Raised by: offline.

### corpus-manifest-shape

Severity: error. Raised by: offline.

### corpus-manifest-skipped

Severity: warning. Raised by: build.

### corpus-page-chunk-metadata

Severity: error. Raised by: offline.

### corpus-page-chunk-missing

Severity: error. Raised by: offline.

### corpus-page-duplicate

Severity: error. Raised by: offline.

### corpus-page-hash

Severity: error. Raised by: offline.

### corpus-page-markdown-missing

Severity: error. Raised by: offline.

### corpus-page-markdown-url

Severity: error. Raised by: offline.

### corpus-page-markdown-utf8

Severity: error. Raised by: offline.

### corpus-page-shape

Severity: error. Raised by: offline.

### corpus-page-tokens

Severity: error. Raised by: offline.

### corpus-tokenizer-fallback

Severity: warning. Raised by: build.

### corpus-tokenizer-identity

Severity: error. Raised by: offline.

### corpus-tokenizer-load-failed

Severity: warning. Raised by: build.

### small-corpus-first-block-omitted

Severity: warning. Raised by: build.

### small-corpus-preamble-over-budget

Severity: warning. Raised by: build.

### small-corpus-truncated

Severity: warning. Raised by: build.

### small-corpus-wrapper-omitted

Severity: warning. Raised by: build.

## Category: structured-data

### authored-jsonld-invalid

Severity: warning. Raised by: build.

### authored-jsonld-malformed

Severity: warning. Raised by: build.

### managed-graph-canonical-missing

Severity: warning. Raised by: build.

### managed-graph-invalid

Severity: error. Raised by: build.

### plugin-graph-inconsistent

Severity: error. Raised by: build.

### plugin-graph-validation

Severity: warning. Raised by: build.

### schema-corpus-canonical-missing

Severity: error. Raised by: build.

### schema-corpus-invalid

Severity: error. Raised by: build.

### schema-corpus-late-semantic-change

Severity: error. Raised by: build.

### schema-map-anonymous-entity

Severity: warning. Raised by: build.

### schema.duplicate-role

Severity: error. Raised by: build.

### schema.invalid-graph

Severity: error. Raised by: build.

### schema.invalid-id

Severity: error. Raised by: build.

### schema.invalid-known-id

Severity: error. Raised by: build.

### schema.invalid-known-ids

Severity: error. Raised by: build.

### schema.invalid-reference

Severity: error. Raised by: build.

### schema.invalid-validation-url

Severity: error. Raised by: build.

### schema.relative-url-base-missing

Severity: error. Raised by: build.

### schema.scalar-conflict

Severity: error. Raised by: build.

### schema.scalar-conflict-resolved

Severity: warning. Raised by: build.

### schema.unresolved-reference

Severity: error. Raised by: build.

### schema.unsafe-url

Severity: error. Raised by: build.

## Category: internationalization

### aeo-head-locale-invalid

Severity: warning. Raised by: build.

### corpus-locale-canonical-missing

Severity: error. Raised by: offline.

### corpus-locale-canonical-order

Severity: error. Raised by: offline.

### corpus-locale-duplicate

Severity: error. Raised by: offline.

### corpus-locale-required

Severity: error. Raised by: build.

### corpus-locale-shape

Severity: error. Raised by: offline.

### corpus-page-locale-missing

Severity: error. Raised by: offline.

### sitemap-hreflang-canonical-mismatch

Severity: error. Raised by: offline.

### sitemap-hreflang-duplicate

Severity: error. Raised by: offline.

### sitemap-hreflang-invalid

Severity: error. Raised by: offline.

### sitemap-hreflang-not-reciprocal

Severity: error. Raised by: offline.

### sitemap-hreflang-target-missing

Severity: error. Raised by: offline.

### sitemap-hreflang-url-invalid

Severity: error. Raised by: offline.

## Category: links

### corpus-link-missing

Severity: error. Raised by: offline.

## Category: build

### artifact-commit-failed

Severity: error. Raised by: build.

### artifact-external-owner-preserved

Severity: warning. Raised by: build.

### artifact-external-owner-replaced

Severity: info. Raised by: build.

### artifact-generated-conflict

Severity: error. Raised by: build.

### artifact-group-skipped

Severity: warning. Raised by: build.

### artifact-invalid-destination

Severity: error. Raised by: build.

### artifact-invalid-pathname

Severity: error. Raised by: build.

### artifact-invalid-replacement-path

Severity: error. Raised by: build.

### artifact-invalid-representation

Severity: error. Raised by: build.

### artifact-redaction-failed

Severity: error. Raised by: build.

### catalog-foreign-origin-companion

Severity: warning. Raised by: build.

### catalog-invalid-date

Severity: warning. Raised by: build.

### catalog-invalid-last-modified

Severity: warning. Raised by: build.

### catalog-invalid-origin

Severity: warning. Raised by: build.

### catalog-invalid-pathname

Severity: warning. Raised by: build.

### catalog-load-failed

Severity: warning. Raised by: build.

### catalog-missing-list-pages

Severity: warning. Raised by: build.

### catalog-owned-artifact-excluded

Severity: warning. Raised by: build.

### catalog-path-conflict

Severity: warning. Raised by: build.

### catalog-unconfigured-origin

Severity: warning. Raised by: build.

### catalog-unsupported-module-format

Severity: warning. Raised by: build.

### plugin-artifact-missing

Severity: error. Raised by: build.

### plugin-build-complete-isolated

Severity: error. Raised by: build.

### plugin-html-delta-conflict

Severity: error. Raised by: build.

### prerendered-custom-404-negotiation

Severity: warning. Raised by: build.

### processing-cache-invalid

Severity: warning. Raised by: build.

### processing-cache-lock-unavailable

Severity: warning. Raised by: build.
