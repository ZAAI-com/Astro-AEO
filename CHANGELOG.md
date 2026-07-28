# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.1.0

### Added

- `pnpm run test:types`: a consumer typecheck of `fixtures/types-consumer/` against the oldest
  supported TypeScript (the `typescript-floor` devDependency alias, currently 5.5). It imports the
  package through its real `exports` map, so the hand-written `.d.ts` files are covered the way a
  downstream project sees them.

### Changed

- Dev toolchain and CI actions updated to their latest versions.
- Maintenance release: no functional or configuration-surface changes for consumers.

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
