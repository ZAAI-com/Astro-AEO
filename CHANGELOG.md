# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.2.0

Astro-AEO 1.2 completes the universal representation work and adds deterministic semantic
publishing through one shared build/runtime pipeline.

### Highlights

- Added edge-safe `astro-aeo/schema`, including pure graph creation, merge, deduplication,
  reference validation, deterministic XSS-safe serialization, `schema-dts` vocabulary types, and
  dedicated builders for the 17 initial Schema.org types.
- Added `AeoHead` for complete metadata and one managed JSON-LD graph. Global graph injection is
  enabled by default, while explicit `AeoHead` output remains available when global injection is
  disabled. Authored JSON-LD is inspected but never rewritten.
- Expanded `AeoPageRecord` into the serializable page, source, representation, entity, directive,
  and diagnostic model shared by builds, runtime, plugins, and manifests. The smaller `AeoPage`
  predicate type and the existing flat record mirrors remain compatible through 1.x.
- Added importable Markdown renderers and the explicit `astro-aeo/mdx` and
  `astro-aeo/defuddle` optional adapters. MDX is parsed without evaluation, and Defuddle is forced
  into synchronous, local-only extraction with no network fallback.
- Published plugin API v1 with all eight lifecycle stages, immutable inputs, isolated failures,
  strict JSON runtime options, exact artifact claims, and safe lazy page access. The semantic
  graph implementation uses the same dispatcher.
- Added opt-in, experimental `/schema/graph.jsonld` and `/schema/schema-map.xml` corpus outputs as
  an atomically owned pair. These files are Astro-AEO-specific discovery aids, not standardized
  Schema.org or Google discovery formats.

### Upgrade notes

- `schema.autoInject` now defaults to `true`, so upgrading adds managed JSON-LD to eligible pages
  with stable canonical URLs. Set `schema: { autoInject: false }` to restore 1.1 HTML behavior;
  this does not disable an explicitly rendered `AeoHead`.
- The richer required `AeoPageRecord` is an accepted TypeScript compatibility exception. Existing
  flat runtime and type mirrors remain available and deprecated through 1.x.
- Artifact ownership now defaults to project routes and `public/` files. Core output may replace
  one only when its exact normalized served pathname is listed in `artifacts.replace`; plugin
  artifacts use per-claim `replace: true`. Duplicate generated claims emit neither claimant.
- Configuring an Astro adapter authorizes injected on-demand fallback routes for `.md` and enabled
  runtime artifacts. This can turn an otherwise static adapter build into server or hybrid output.
- `schema-dts` is a direct dependency. `@mdx-js/mdx` and `defuddle` are optional peers and have no
  effect unless their adapters are explicitly registered.

### Reliability and security

- Build output now passes through staged graph, artifact, ownership, and threshold validation
  before atomic commit. Ownership manifests permit stale cleanup only for unmodified files proven
  to have been written by Astro-AEO.
- Managed HTML edits use targeted ranges, preserve unrelated authored bytes, and strip internal
  page/head markers even when validation aborts. Diagnostics omit content, entity values, plugin
  payloads, marker data, secrets, and thrown values.
- Runtime artifacts reuse the core `GET`/`HEAD`, ETag, conditional request, cache, path-safety, and
  ownership behavior. Vercel and Netlify fallback routing now reaches Astro-AEO before provider
  404 handling.
- MDX adapters discard active authored elements before component mappings, plugin runtime options
  are cloned into the resolved configuration, and schema diagnostics distinguish unsafe URLs from
  relative URLs that require `documentCanonical`.
- Secure live corpora continue to require Astro 6.3 or newer. Astro 5 and Astro 6.0 through 6.2
  return `503` with `Cache-Control: no-store`; direct Markdown, negotiation, static corpora, and
  non-corpus behavior remain supported.

## 1.1.0

Astro-AEO 1.1 makes configuration clearer, improves Markdown quality, and brings consistent,
secure request-time behavior to development and adapter deployments.

### Highlights

- Configuration is now organized by output under `site`, `pages`, `markdown`, `corpus`, and
  `discovery`. The [migration guide](README.md#migrating-from-10) maps every 1.0 key, and running
  `AEO_PRINT_MIGRATION=1 astro build` prints a paste-ready config from the options a project uses.
- [Markdown extraction](README.md#extraction) now uses a real DOM, supports ordered content roots,
  removable chrome, and HTML-preserving selectors, and retains structures and accessible names
  that the previous conversion could lose.
- Pages built from Markdown can preserve their authored source with
  [`AeoPage` and `defineAeoPage`](README.md#giving-a-page-its-own-source). Standalone Markdown
  routes also carry their original source into server bundles.
- [Page catalogs](README.md#pages-the-build-cannot-see) can add data-generated routes that Astro's
  route list cannot discover, so eligible routes receive companions and appear in corpora.
- [Content negotiation](README.md#content-negotiation) can return Markdown at a page URL or redirect
  to its `.md` companion when Markdown is explicitly preferred on an on-demand route.
- Live `llms.txt` and `llms-full.txt` generation renders known pages serially and limits work
  with `corpus.runtime.maxPages`, which defaults to 50 and returns `503` instead of partial output
  when exceeded.
- [Sitemap handling](README.md#sitemap) now has `auto`, `external`, and `disabled` modes, with its
  alias and `robots.txt` advertising tied to sitemap output that actually exists.
- New serializable page, catalog, source, extraction, and diagnostic types support integrations and
  tooling. The release also exports `astro-aeo/extract`, `ResolvedAstroAeoConfig`, and the
  committed [configuration schema](schema/astro-aeo.schema.json).

### Upgrade notes

- Every 1.0 configuration key remains supported until 2.0 and produces the same output as its
  canonical replacement. If both spellings set the same option to different values, the build now
  stops and names the conflict instead of choosing silently.
- Relative links and image sources in generated Markdown now resolve against the page's canonical
  URL. The improved extraction also deliberately changes Markdown where older output lost
  structure or accessible names; other renderer formats remain stable.
- `ResolvedAeoConfig` is deprecated and frozen at the 1.0 shape. Type consumers should move to
  `ResolvedAstroAeoConfig`; this is a type-only change.
- Live request-time corpora require Astro 6.3 or newer so each rendered page can use disposable
  request state. Astro 5 and Astro 6.0 through 6.2 fail closed with `503`; build artifacts and
  direct authenticated `.md` requests remain supported.

### Reliability

- One Astro middleware now serves direct companions, text artifacts, and negotiated Markdown in
  development and adapter deployments. Direct `.md` rewrites pass through application middleware
  so authentication applies, while statuses, redirects, cache policy, `HEAD`, conditional
  requests, and non-HTML responses are preserved.
- A shared artifact writer now diagnoses collisions between Astro-AEO outputs, project routes,
  `public/` files, and existing destinations while preserving each output's established overwrite
  policy.
- Live corpora use serialized, anonymous in-process rewrites rather than Host-derived network
  requests. Caller credentials and shared caches are isolated, traversal is rejected, and internal
  source markers are removed before content is written or served.
- Benchmark regression explanation: The extraction, corpus, catalog, request-isolation, and
  response-hardening work adds about 17 percent packed and 18 percent unpacked to the portable
  package. The Node integration bundle grows by about 46 percent raw and 44 percent gzip because
  the request-isolation and response-hardening code ships in the consumer's server bundle. Every
  absolute package, bundle, startup, memory, and timing ceiling remains enforced.

## 1.0.0

### Changed

- First stable release. The configuration surface and generated outputs are considered stable under Semantic Versioning; no functional changes since `0.8.0`.

## 0.8.0

### Added

- `sitemap` support (default on): Astro-AEO now auto-wires the official `@astrojs/sitemap` integration when the feature is enabled, Astro `site` is set, and no sitemap is already registered. A late finalizer verifies the configured sitemap file before adding the `robots.txt` `Sitemap:` line, so filters, serializers, invalid options, or an empty site cannot leave a dead URL behind. The line defaults to `/sitemap-index.xml` and tracks `sitemap.options.filenameBase`. For a separately registered sitemap, repeat a custom `filenameBase` in Astro-AEO as the shared output-name hint; the other options remain owned by the user integration.
- `sitemapAlias` support (default on when a sitemap source exists): Astro-AEO byte-copies the generated sitemap index to a conventional `/sitemap.xml`, so SEO and uptime tools that probe that path resolve it instead of getting a 404. The alias never overwrites an existing build output, including files from `public/`, prerendered Astro endpoints, and other integrations. Configure via `sitemapAlias.outputFilename` (default `sitemap.xml`) and `sitemapAlias.sourceFilename` (default derived from `filenameBase`); opt out with `sitemapAlias.enabled: false`.

### Changed

- `@astrojs/sitemap` is now a runtime dependency. Astro-AEO deliberately keeps dependencies minimal, but sitemap generation is core to SEO/AEO and the official integration handles the hard parts (index splitting past 50k URLs, i18n alternates, `lastmod`); reusing it is the strong reason to add the dependency rather than re-implement the spec.
- `robotsTxt.includeSitemap` now has three states without adding a new option: omitted automatically verifies static output, explicit `true` forces the line for runtime-only sitemaps, and `false` suppresses it. User-registered sitemaps remain eligible when `sitemap.enabled` is false because that flag controls auto-registration only.
- Minimum Node is now 20.19.5 (raised from 20.3), pulled in by `@astrojs/sitemap`'s `sitemap` dependency.

## 0.7.0

### Added

- `robotsTxt.universalAllow` (default `true`): emit a leading `User-agent: *` / `Allow: /` group regardless of named allow/disallow groups, so a fully-open site that also names answer-engine bots keeps its catch-all. Suppressed automatically when `*` is already listed.
- Validator warning `robots-no-wildcard`: flags a `robots.txt` that names specific user-agents but has no `User-agent: *` group.
- Nested config-key validation: unknown keys inside `site`, `dotmd`, `llmsTxt`, `llmsFullTxt`, `urlMap`, `robotsTxt`, and `domainProfile` now warn (e.g. `robotsTxt.sitemaPath`), not just unknown top-level keys.
- `domainProfile.email`: routed into the schema.org profile by value shape (`http(s)` URL -> `contactPoint`, contains `@` -> `email`, otherwise `telephone`).
- README "Serving .md companions" section with `Content-Type: text/markdown; charset=utf-8` header config for Render, Netlify/Cloudflare Pages, Vercel, and nginx.
- Validator checks for page title length, missing image `alt` attributes, robots meta tags, Open Graph title and description length, absolute `og:image` URLs, and `twitter:card=summary_large_image`.
- Error-level validator finding `img-missing-alt`: `astro-aeo validate` now exits `1` when an indexable page has one or more `<img>` tags without an `alt` attribute. Use `alt=""` for decorative images.
- Advisory validator warning `robots-meta-missing`: absence of `<meta name="robots">` is still crawler-safe by default, but the validator now reports it for audit compatibility.

### Changed

- `robots.txt` no longer drops the universal `User-agent: *` group when `allow`/`disallow` name specific bots; the catch-all is controlled by `robotsTxt.universalAllow`.

### Deprecated

- `domainProfile.contact` is renamed to `domainProfile.email`. The old key still works but emits a deprecation warning.

## 0.6.0

Initial public release. Feature parity with Jekyll-AEO, plus Astro-only extras.

### Added

- `.md` companion pages generated from rendered HTML via Turndown.
- `<link rel="alternate" type="text/markdown">` injection with `auto`, `always`, and `never` modes.
- `llms.txt` and `llms-full.txt` following the llmstxt.org spec, with a configurable section engine (glob, RegExp, or predicate matchers) and a default-section fallback.
- `robots.txt` with allow/disallow bot policies, configurable sitemap path, `llms.txt` hint, and extra lines.
- `/.well-known/domain-profile.json` with `sameAs` support and site-URL fallback.
- URL map output (`docs/Url-Map.md` by default).
- JSON-LD components: `FaqJsonLd`, `HowToJsonLd`, `BreadcrumbJsonLd` (auto-derived), `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`.
- `astro-aeo validate` CLI with `--strict`, `--json`, `--quiet`, and `--base`.
- Dev-server preview: `robots.txt`, `domain-profile.json`, and `.md` companions served in `astro dev`, plus a static-route `llms.txt`.
- Git-based last-modified dates, with `article:modified_time` taking precedence.
- Per-page control via `<meta name="aeo" content="...">` and `respectNoindex`.
- Configurable title-suffix stripping and include/exclude path globs.
