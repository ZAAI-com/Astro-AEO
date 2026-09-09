# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.3.0

Astro-AEO 1.3 adds deterministic multilingual discovery and incremental processing while keeping
ordinary single-locale 1.2 output bytes unchanged.

This release also consumes the stabilized 1.2 patch contracts: canonical URL bases, semantic
graph reconciliation, aligned artifact ownership, exact-path validation, and corrected public
schema IDs.

Benchmark regression explanation: The package and integration bundles grow because 1.3 ships a
dependency-free multilingual planner, strict XML and corpus validators, processing cache, frozen
crawler registry, and failure-safe IndexNow CLI on top of runtime-safe semantic reconciliation.
The measured package remains below the updated 1.3 safety ceiling, and all absolute bundle,
startup, memory, and request ceilings remain enforced.

### Highlights

- Added automatic enumeration of prerendered `getStaticPaths()` routes in development corpora.
  Stable `startup` discovery uses Astro's public route hooks, while opt-in experimental `hot`
  discovery also tracks dynamic route-file additions and deletions through Astro's private route
  module.
- Added one shared build/runtime corpus planner with `auto`, `global`, `locale`, and `both`
  multilingual topologies, normalized BCP 47 languages and alternates, small token-budgeted
  corpora, section chunks, versioned manifests, custom tokenizer fallback, and deterministic
  static gzip siblings.
- Added content-addressed processing reuse under `.astro/aeo-cache`, restrictive private-state
  permissions, process-safe locking, clean-output restoration, and atomic ownership/state commits.
- Added strict sitemap index and shard validation plus manifest-first `astro-aeo validate` checks
  for locale families, hashes, token counts, aliases, and gzip bytes.
- Added frozen crawler classifications, four RFC 9309 policy presets, explicit Content Signals,
  and two-phase IndexNow prepare/submit commands with public, private, and stateless ledgers.
- Extended page, catalog, renderer, plugin, tokenizer, manifest, and runtime declarations without
  changing the frozen `ResolvedAeoConfig` compatibility type.

### Correctness and safety (review backlog)

- Corpus ownership ([#8](https://github.com/ZAAI-com/Astro-AEO/issues/8)): `llms.txt` and
  `llms-full.txt` are handed to request-time middleware only when one of the project's own page
  routes renders on demand. Astro-AEO injects `prerender: false` fallback routes for every adapter,
  which promotes the build to server output, and the previous rule read that promotion back as
  proof that a server was required. A fully prerendered site with an adapter silently emitted no
  corpus at all. The `dynamic-routes-unindexed` diagnostic follows the same ownership decision, so
  it no longer asks a prerendered project for a `pages.catalogs` module it does not need. Once the
  build owns those paths the runtime declines them, along with the schema graph and map, so a
  deployment that reaches the application before its static files cannot answer with a shorter
  corpus than the one on disk. Verified against real workerd through a new static Cloudflare
  adapter fixture.
- Request-state diagnostics: the request-time corpus `503` reports an unrecognized Astro request
  state instead of naming a version range the middleware cannot observe, and the anonymous corpus
  session derives its runtime mode from the build command rather than from a pipeline field Astro 7
  removed.
- Manifest truthfulness: companion-less pages publish nullable `markdownUrl` / `tokenCount` /
  `hash`; companion hashes and token counts match the bytes from `renderMarkdownDocument`.
- Corpus topology: dependent claims (aliases, gzip, manifest) follow ownership decisions; the
  corpus manifest drops artifacts that lost arbitration (and their entries from every page's
  chunk list) or is skipped with a `corpus-manifest-skipped` warning when a locale canonical
  artifact was lost; runtime fallback routes cover small, manifest, locale, alias, and chunk
  paths on manifest-based adapters.
- IndexNow safety: `keyLocation` directory scope is enforced at submit; response limits and queue
  writes stay compatible with generated state; `IndexNowInvocationError` exits 2.
- IndexNow removals are withheld whenever a build could not see every page, which now covers
  rejected catalog descriptors, failed plugin hooks, and pages whose built HTML could not be read,
  not only a catalog that failed to load. Previously such a page was still live but read as a
  removal, which submitted it and deleted the URL from the acknowledgment ledger. Additions and
  changes are queued as usual in that build rather than being suppressed alongside the removals,
  and a build that cannot write its private state no longer publishes a state manifest whose digest
  the pending queue does not match. An unreadable page now reports `page-html-unreadable` instead
  of only logging.
- Locks: stale processing-cache and IndexNow lock reclamation runs under a dedicated
  `${path}.reclaim` mutex, so the validate, unlink, and re-claim sequence is exclusive and two
  contenders can never both unlink the other's replacement; ownership checks on release remain.
- Sitemap: legal non-declaration processing instructions (for example `xml-stylesheet`) validate
  and their targets are name-checked, so `<?1bad?>` or `<?a:b:c?>` are rejected; query strings
  remain part of sitemap URL identity; XML-only whitespace (space, tab, CR, LF) is the mixed-
  content standard, so an NBSP inside `<url>` is reported instead of trimmed away.
- Robots: `Content-Signal` is emitted inside each user-agent group; locale-only indexes do not
  advertise a root `/llms.txt`.
- Runtime edges: page lifecycle failures become corpus-plan errors; catalog locale metadata reaches
  plugin handles; Astro 7.2 one-argument FetchState is supported; loopback origin trust stays
  development-only (Astro 5 and 6 projects on `@astrojs/node` need
  `security.allowedDomains` so the deployed request keeps its real `Host`); encoded locale
  pathnames resolve consistently.
- Prerendered pages no longer read request headers, which Astro warns about. HTML enrichment and
  marker redaction still emit fresh ETags, while Accept negotiation and conditional requests remain
  available for on-demand routes.
- The development on-demand dynamic-route warning is emitted exactly once. With
  `pages.devDynamicDiscovery: 'hot'` the generated loader owns the message, because only it sees
  routes added after the last route resolution, and its guard lives on the development process so a
  re-executed loader stays quiet.
- Multi-domain corpus topology: the build filtered its pages by the site origin before handing them
  to the shared planner, which already applies that filter internally and separately needs the
  complete set to choose a topology. The build therefore saw one locale under `i18n.domains` and
  reserved a legacy root `/llms.txt` instead of the locale families and root language directory that
  middleware serves. Request-time output was never affected; ownership arbitration, stale-output
  removal, and the recorded claim set were.
- Catalog origins reach the build: a descriptor naming another configured host kept that host at
  request time but silently inherited the primary site origin during a build. Descriptor origins now
  survive collection, and an origin the project is not configured for is excluded with a
  `catalog-unconfigured-origin` diagnostic, matching the runtime loader.
- Reachable hreflang canonical conflicts: `hreflang-canonical-conflict` compared a page found by its
  canonical URL against that same URL, so it could never fire, and an alternate naming a local
  page's non-canonical URL was reported nowhere. Local pages are now indexed by their served URL as
  well, and pages that declare no canonical URL are checked through their served URL instead of
  being skipped. A target that declares no canonical URL is still never called non-canonical.
  Reciprocity is a map lookup rather than a scan over every page, which removes a quadratic cost
  from both builds and request-time corpus renders.
- Development corpora carry the dev-preview banner in every non-single-locale topology. The note
  previously reached only the legacy root `llms.txt` and `llms-full.txt`; grouped, locale, and
  small corpora now match those bytes, chunk files stay note-free because they open with a page
  heading, and the note is budgeted against `corpus.small.maxTokens`.
- Multi-line Setext headings stay indivisible. A paragraph run whose last line is an `===` or
  `---` underline is classified as one heading instead of being split at the line the old
  one-line lookahead stopped scanning.
- Sitemap namespace maps are copied only on declaration, so a per-element `xmlns:xhtml`
  declaration no longer leaks into a sibling `<url>` entry.

### Upgrade notes

- Adapter projects whose page routes are all prerendered now receive build-time `llms.txt` and
  `llms-full.txt` containing every `getStaticPaths()` result, where 1.2 emitted nothing and left
  the paths to middleware. Projects with at least one on-demand page route are unchanged. If you
  relied on the request-time corpus for a fully prerendered adapter build, the emitted file is
  served first by every supported adapter and is strictly more complete. A deployment that mounts
  the Astro handler ahead of its own static handler, such as `@astrojs/node` in middleware mode,
  now receives `404` on those paths rather than a silently shorter corpus. Serve static output
  first.
- `hreflang-canonical-conflict` is reachable for the first time and is an `error`, so with the
  default `validation.onBuild: 'artifacts'` and `validation.failOn: 'error'` it can fail a build
  that previously passed. It fires when a page's `hreflang` alternate names a local page by a URL
  that is not that page's canonical. Point the alternate at the canonical URL, or lower
  `validation.failOn`.
- `pages.devDynamicDiscovery` defaults to `'startup'`; select experimental `'hot'` for route-file
  HMR or `false` to retain catalog-only development enumeration. Catalogs remain necessary for
  on-demand and external inventories and can overlay automatic paths with authored metadata.
- Article documentation now recommends Google-preferred ISO 8601 datetimes with timezone
  information while clarifying that bare Schema.org dates remain valid and authored values pass
  through unchanged.
- New corpus files, gzip, crawler presets, Content Signals, and IndexNow are opt-in. One implicit
  locale keeps the legacy root corpus bytes. Multilingual `auto` moves canonical locale families
  under `/<locale>/`; use `global`, `locale`, or `both` for another published topology.
- Enabled project-root URL maps once again replace their configured output on every successful
  build, restoring the behavior from before 1.2.0. The replacement remains part of the atomic
  artifact transaction.
- `.astro/aeo-cache` may contain derived page content and must remain uncommitted and protected as
  sensitive build state. CI deployments using IndexNow must transfer the pending and
  acknowledgment directory between prepare and submit jobs.
- Runtime serves logical corpus artifacts but does not precompress gzip. Hosting transport remains
  responsible for runtime compression.
- Crawler presets and Content Signals express preferences only. They are not access control and do
  not guarantee crawler compliance.
- Astro 7.3 needs no code change. Two consumer-facing notes were added to the README: a hand-written
  `astro/fetch` Cloudflare entrypoint must call `finalize(state, response)` so cookies merged during
  a direct `.md` rewrite still reach the client, and Astro's `memoryCache()` now skips responses
  carrying `Vary: Cookie` or `Vary: *`, which negotiated responses do not.

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
- Semantic graph validation now preserves each page's canonical base and the configured Astro
  base path, reconciles plugin graph replacements with the managed JSON-LD script, and rejects
  malformed nested JSON-LD fields before serialization.
- Build and runtime ownership now agree for Markdown companions, runtime-only artifacts, catalog
  pages, homepage plugin handles, replacement claims, and sitemap cleanup. Recommended validation
  includes page-local findings before the artifact transaction commits.
- Managed HTML edits use targeted ranges, preserve unrelated authored bytes, and strip internal
  page/head markers even when validation aborts. Diagnostics omit content, entity values, plugin
  payloads, marker data, secrets, and thrown values.
- Runtime artifacts reuse the core `GET`/`HEAD`, ETag, conditional request, cache, path-safety, and
  ownership behavior. Vercel and Netlify fallback routing now reaches Astro-AEO before provider
  404 handling.
- MDX adapters discard active authored elements before component mappings, plugin runtime options
  are cloned into the resolved configuration, and schema diagnostics distinguish unsafe URLs from
  relative URLs that require `documentCanonical`.
- Canonical attributes decode HTML entities, source kinds use one shared inference policy, runtime
  plugin option omission remains distinct from `null`, and exact artifact path validation is
  aligned between startup and the published configuration schema.
- Secure live corpora continue to require Astro 6.3 or newer. Astro 5 and Astro 6.0 through 6.2
  return `503` with `Cache-Control: no-store`; direct Markdown, negotiation, static corpora, and
  non-corpus behavior remain supported.
- Benchmark regression explanation: The Node integration bundle grows by about 17 percent raw and
  15 percent gzip because runtime-safe semantic graph reconciliation and fail-closed plugin
  pathname validation now ship in the consumer server bundle. This is the accepted cost of
  preserving authored JSON-LD and matching build/runtime ownership behavior; all absolute bundle,
  startup, memory, and request ceilings remain enforced.

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
- [Page catalogs](README.md#dynamic-routes-and-catalogs) can add data-generated routes that Astro's
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
