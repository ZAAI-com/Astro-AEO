# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.1.0

### Added

- Canonical nested configuration. Options are now grouped by what they produce: `site` (including
  `site.profile`), `pages`, `markdown`, `corpus` (`index`, `full`, `urlMap`), and `discovery`
  (`sitemap`, `sitemap.alias`, `robots`). The flat 1.0 surface had grown to thirteen top-level keys
  whose names described implementation details (`dotmd`, `llmsTxt`) rather than outputs.
- `discovery.sitemap.mode`: `'auto'` (auto-register `@astrojs/sitemap`), `'external'` (use a
  sitemap the project registers itself), or `'disabled'` (opt out entirely, including the alias and
  the `robots.txt` `Sitemap:` line). `'disabled'` has no 1.0 equivalent.
- `markdown.extraction`: `selectors` (default `['article', 'main']`, tried in order, first with a
  match wins), `removeSelectors` (default `['nav', 'footer']`), and `keepSelectors` (emit matching
  elements as raw HTML). `script`, `style`, `noscript`, `iframe`, and `head` are always dropped and
  can never be reintroduced by `keepSelectors`. An invalid or empty selector is a configuration
  error rather than a silent no-op.
- `AEO_PRINT_MIGRATION=1` prints a paste-ready canonical config block derived from the 1.0 keys a
  project actually sets. It runs inside Astro, so it works for `.mjs` and `.ts` configs alike.
- `pnpm run test:types`: a consumer typecheck of `fixtures/types-consumer/` against the oldest
  supported TypeScript (the `typescript-floor` devDependency alias, currently 5.5). It imports the
  package through its real `exports` map, so the hand-written `.d.ts` files are covered the way a
  downstream project sees them.

### Changed

- Every 1.0 configuration key still works and produces byte-identical output. This is asserted by
  `fixtures/config-compat`, one site written twice (once fully in 1.0 keys, once fully in 1.1 keys)
  and built twice, with the two outputs diffed file by file. Using a 1.0 key emits one deprecation
  warning per section. They are removed in 2.0.
- Setting a 1.0 key and its 1.1 replacement to **different** values is now a build-stopping error
  naming both paths. Silently preferring one could publish the wrong `robots.txt` policy. Mixing
  eras is fine when the two address different settings.
- Metadata extraction (description, `aeo` tokens, `robots`, `article:modified_time`, redirect
  stubs) now shares one quote-aware `<meta>` scanner instead of a regular expression per field.
  Attribute order, unquoted values, and a `>` inside a quoted value are handled for every field.
  Previously only `extractMetaContent`, which `extractPageMeta` did not use, was that robust.
- All build output now goes through one artifact writer, which reports a collision instead of
  letting it pass silently. Three cases are newly diagnosed: two astro-aeo generators claiming one
  path, a path also produced by a route in the project (a `src/pages/llms.txt.ts` endpoint had its
  output clobbered with no indication of what did it), and a path also committed to `public/`. The
  per-output collision policies are unchanged: `robots.txt` still warns before overwriting, and the
  sitemap alias still refuses to replace an existing file.
- Unknown-key warnings are emitted at any depth, so a typo in `discovery.sitemap.alias.enabld` is
  reported as precisely as a top-level one. Options forwarded to `@astrojs/sitemap` are never
  inspected.
- The `robots.txt` `Sitemap:` tri-state (omitted, `true`, `false`) is resolved once into the
  config as `discovery.robots.sitemapPolicy`, rather than being recovered from raw user input in
  the integration entry point.
- Dev toolchain and CI actions updated to their latest versions.

### Fixed

- Content extraction is now performed against a parsed DOM (`linkedom`) rather than a regular
  expression over the source text. The previous non-greedy `<main>` match stopped at the first
  `</main>` wherever it appeared, so a closing tag inside a comment, a script string, or a
  `<template>` truncated the page; and when a document had no `<main>` at all, the entire
  document including `<head>` was handed to the converter.
- `astro dev` no longer risks handling its own internal page fetches: the `x-astro-aeo` marker it
  has always sent is now actually checked.

### Output

- Relative links and image sources in `.md` companions are resolved against the page's own
  canonical URL. A companion is normally read away from the site that served it, where a
  root-relative href is a dead link. Fragment links and non-navigational schemes (`mailto:`,
  `tel:`) are left exactly as authored. **This changes existing `.md` and `llms-full.txt` output
  for pages containing relative links**, and is the one deliberate output change in this release.
- All other generated artifacts are byte-identical to 1.0.

### Types

- `ResolvedAeoConfig` is deprecated and frozen at the 1.0 shape. The resolved config is now
  `ResolvedAstroAeoConfig`. This is a type-only change: `resolveConfig` is not part of the package
  `exports` map, so no value of that type was ever obtainable at runtime.
- The public config type is now `AstroAeoConfig extends CanonicalAeoConfig, LegacyAeoConfig`, and
  the resolved type is hand-written rather than derived. The previous derived type collapsed
  `Record<string, unknown>` index signatures to `Record<string, {}>`, which forced a cast on
  `sitemap.options`.

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
