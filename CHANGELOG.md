# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.8.0

### Added

- Validator checks for page title length, missing image `alt` attributes, robots meta tags, Open Graph title and description length, absolute `og:image` URLs, and `twitter:card=summary_large_image`.
- Error-level validator finding `img-missing-alt`: `astro-aeo validate` now exits `1` when an indexable page has one or more `<img>` tags without an `alt` attribute. Use `alt=""` for decorative images.
- Advisory validator warning `robots-meta-missing`: absence of `<meta name="robots">` is still crawler-safe by default, but the validator now reports it for audit compatibility.

## 0.7.0

### Added

- `robotsTxt.universalAllow` (default `true`): emit a leading `User-agent: *` / `Allow: /` group regardless of named allow/disallow groups, so a fully-open site that also names answer-engine bots keeps its catch-all. Suppressed automatically when `*` is already listed.
- Validator warning `robots-no-wildcard`: flags a `robots.txt` that names specific user-agents but has no `User-agent: *` group.
- Nested config-key validation: unknown keys inside `site`, `dotmd`, `llmsTxt`, `llmsFullTxt`, `urlMap`, `robotsTxt`, and `domainProfile` now warn (e.g. `robotsTxt.sitemaPath`), not just unknown top-level keys.
- `domainProfile.email`: routed into the schema.org profile by value shape (`http(s)` URL -> `contactPoint`, contains `@` -> `email`, otherwise `telephone`).
- README "Serving .md companions" section with `Content-Type: text/markdown; charset=utf-8` header config for Render, Netlify/Cloudflare Pages, Vercel, and nginx.

### Changed

- `robots.txt` no longer drops the universal `User-agent: *` group when `allow`/`disallow` name specific bots; the catch-all is controlled by `robotsTxt.universalAllow`.

### Deprecated

- `domainProfile.contact` is renamed to `domainProfile.email`. The old key still works but emits a one-time warning.

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
