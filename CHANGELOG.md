# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.5.0

The cache-integrity, Markdown-fidelity, and EmDash release. The incremental processing cache now
resets itself whenever the extractor changes and stops growing without bound, and Markdown companions
keep meaningful separators, intact bold definition terms, both images of a before/after figure, and
languages on code fences. The new `astro-aeo/emdash` integration sets up an EmDash CMS site in one
line, and page catalogs gain one optional key, `pages.catalogs[].revalidate`.

### Behavior changes worth reading before upgrading

- The first build after upgrading extracts every page again and logs the cache reset once. A cache
  written by 1.4.0 or earlier has no producer record, so the line reads
  `astro-aeo: processing cache reset after an extractor change (an earlier astro-aeo -> astro-aeo 1.5.0); 24 cached page(s) will be extracted again`.
- Markdown changes on pages that use the affected markup: `aria-hidden` separators and tree glyphs,
  icons inside `<dt>` terms, multi-image figures, and code blocks. The same changes apply to
  on-demand and SSR Markdown and to `astro-aeo/extract`, not only to build companions.
- IndexNow resubmits each page whose Markdown changed, once.
- A `<pre>` whose `<code>` starts after a newline now becomes a fenced block instead of inline code.
- Kept separator glyphs also appear inside raw HTML kept through `extraction.keepSelectors` and in
  heading text, so a heading such as `Step 1 · Install` changes its `llms` chunk title.
- Pages whose only `<article>` elements are a grid or list of cards (a blog index, a pricing or
  contact page) now convert from `<main>`, so their companions gain the heading and intro they
  used to drop. A post followed by related-post cards now keeps only the post.

### Processing cache

- The private `.astro/aeo-cache/processing-v1` state now names its producer: the astro-aeo version
  plus the `turndown` and `linkedom` versions it extracts with. The producer is also part of every
  cache key. When it changes (an upgrade, a downgrade, or a lockfile refresh of either dependency),
  the cache drops its entries once and logs the change, for example `(astro-aeo 1.5.0 -> 1.5.1)` or
  `(turndown 7.2.3 -> 7.2.4)`, so a local build can no longer emit Markdown produced by another
  version of any of the three.
- A missing or malformed producer record resets the entries instead of making the cache read-only,
  so it never blocks IndexNow state from advancing.
- A complete build keeps only the entries it used. Pages that were deleted or became excluded stop
  occupying the cache, and their blobs are swept with the same confined-delete authority as before.
  A build whose page inventory is incomplete keeps the entries it could not see.
- Git modification dates are merged after the cached extraction, so a cache hit no longer freezes a
  page's modified date at its first extraction. An invalid cached entry is now replaced instead of
  being rebuilt on every build.

### Markdown companions

- Meaningful `aria-hidden="true"` glyphs are kept. A separator such as `→`, `·`, `|`, or a dash
  between two runs of text in the same line is unwrapped and spaced (`1 user · 2 orgs`, `Status:
  Stable`), and a box-drawing tree prefix such as `├──` or `│` is kept before its entry, with no-break spaces so
  nested rows keep their depth. Arrows in
  or directly after links, glyphs inside buttons, labels, `pre` and `code`, emoji, stars and check
  marks, "Copied" labels, empty dots, svgs, and `[hidden]` elements are still removed.
- A block-level icon inside a `<dt>` no longer splits the bold term across lines, and a term that
  already wraps its text in `<strong>` no longer doubles to `****Term****`. New strong and emphasis
  rules keep any bold or italic run on one line: line breaks at its edges move outside the
  delimiters, blank-line runs inside collapse to one space, and a run without line breaks converts
  exactly as before. Term parts that CSS lays out apart, such as a step number in
  `<span>1</span>Configure`, are spaced (`**1 Configure**`), and a list or other block inside a
  term follows the bold term instead of breaking it.
- Figures keep every shown image. Only alternates of another shown image are dropped: images hidden
  from assistive technology or with `[hidden]`, the dark variant of a light/dark pair
  (`hidden dark:block`, Starlight's `light:sl-hidden`), in either order. A dark-mode border no longer
  collapses a before/after slider to one image. Adjacent images and labels are separated by spaces
  (`![...](...) ![...](...) Dots only Google original`) without indenting figures inside inline
  wrappers, and syntax-highlighted code inside a figure is no longer split by inserted spaces.
- Repeated extraction matches are a listing, not the page. Two or more top-level matches whose
  item boxes share a parent (a grid of `<article>` cards, or `<li>` items that each hold one) are
  set aside, and the next selector decides; a lone match next to such a grid is kept on its own.
  Before, the default `article` selector took every card and dropped the rest of `<main>`.
- Code fences carry their language, taken from a `language-*` or `lang-*` class, `data-language` on
  the `pre` or `code` (Astro's Shiki, Expressive Code), or a filename at the start of the caption of
  a figure holding one code block (`index.html (what most bots see)` gives an `html` fence). An
  explicit `language-*` class is used as written. `plaintext`, `text`, `txt`, and `plain` from the
  other sources give a bare fence. Expressive Code lines keep their line breaks.

### EmDash

- New `astro-aeo/emdash` subpath. `emdashAeo()` goes next to `emdash()` in `integrations` and
  registers Astro-AEO itself: it excludes `/_emdash/**` and `/404`, turns on
  `markdown.negotiation: 'response'`, leaves `robots.txt` and sitemaps to EmDash, and adds a page
  catalog. Options set in `emdashAeo({ aeo })` win. It throws when `aeo()` is also registered, when
  `emdash()` is missing, for legacy 1.0 option names, and for IndexNow, which has no build-time
  inventory to compare on an EmDash site.
- The catalog lists every published entry of every collection with a URL pattern, at the URL EmDash
  builds from it (`{slug}`, `{id}`, and date tokens in UTC), following EmDash's sitemap rules:
  collections with SEO turned off, drafts, deleted entries, entries without a slug, and noindex
  entries are left out. Collections without a pattern, such as the Marketing template's `pages`,
  are skipped rather than guessed. It reads EmDash's public plugin read API through a virtual
  module served from the project's own `emdash` install, so `emdash` is an optional peer, and the
  catalog never opens a database itself.
- Options: `collections` (`false` to leave one out, or a `section` heading whose URLs come from the
  seed's `urlPattern`), `taxonomies` (archive routes to list, for terms with published entries),
  `revalidate` (default 10 seconds), and `maxEntries` (default 50,000). With i18n enabled, only the
  default locale is listed, with one warning.
- Works on Node and Cloudflare. On Cloudflare the catalog reads D1 through EmDash's per-request
  session, so the options are the same.
- Six recipes: `emdash-blog`, `emdash-marketing`, `emdash-portfolio`, and `emdash-starter` mirror
  EmDash 1.0.1's templates, `emdash` is a marketing site with a blog and customer stories that
  mixes them, and `emdash-cloudflare` is that site on D1 and R2. `test/recipes/emdash.test.js`
  seeds, builds, audits, and serves each one (the Cloudflare one in workerd through
  `astro preview`), and proves an entry published while the server runs appears in `llms.txt`. The
  README's new "EmDash CMS" section and `docs/SETUP_PROMPT.md` document the integration.

### Page catalogs

- `pages.catalogs[].revalidate` lists a catalog again at request time once that many seconds have
  passed since its last listing, so a CMS catalog picks up published entries without a server
  restart. `0` lists on every use, and `false` or omitting it keeps today's behavior of one listing
  per process. A revalidating catalog whose first listing fails is retried on its next use
  instead of staying empty, a failed refresh keeps the last listing and retries after another
  window, a refresh runs in the background while the last inventory is served, a listing in
  flight is shared, and a catalog without `revalidate` is never re-listed because another one
  refreshed. Development and builds are unchanged.

### Package size

The published package measures 376,772 packed and 1,440,205 unpacked bytes across 173 files, up from
355,650 and 1,375,031 in 1.4.0 (about 6 and 5 percent). The growth is the cache producer record, the
extraction passes, and the `astro-aeo/emdash` integration with their documentation. Only a project
that uses `emdashAeo()` bundles anything new: the EmDash catalog. The unpacked ceiling moves from
1,380,000 to 1,460,000 bytes.

## 1.4.0

The quality and ecosystem release: a site-wide audit with seven report formats, deployment checks and
fixes, a Starlight plugin, content and CMS helpers, and opt-in static edge negotiation. No
configuration key changes. Markdown extraction also changes existing companions as described below,
even without enabling the new features. Node and Cloudflare bundle sizes remain within the release
limits.

### Behavior changes worth reading before upgrading

- `validation.onBuild: 'recommended'` also gates on the audit rules a build can answer from its page
  model. With the default `failOn: 'error'` the one new blocking rule is `markdown-empty`, a Markdown
  companion with no text. `'artifacts'` and `'off'` are unchanged.
- A catch-all page rendered on demand (`/[...slug]`) no longer owns every `.md` companion and text
  artifact path. Those requests answered a bodyless `404` before and are served now.
- On a site with more than one Astro i18n locale, the inferred site-wide `WebSite` entity no longer
  carries `inLanguage`, which previously failed the build with `schema.scalar-conflict`.
- Repeated `<meta name="generator">` tags no longer report `metadata-conflict`.
- Every build writes a private `.astro/aeo-cache/deployment-v1.json`. It is never published.
- `yaml` is a new runtime dependency, loaded on demand by `astro-aeo fix` alone.

### Review fixes before release

- Refuse symlinked project and build-directory roots, including linked parents, before editing
  provider configuration or reading an offline audit target.
- Make edge declarations match each public subpath's runtime exports and reject duplicate
  normalized routes in an untrusted static edge manifest instead of replacing an earlier entry.
- Return the rendered response from Starlight route middleware after its marker handling.

### Markdown companions

Convert figures, definition lists and simple tables to Markdown instead of copying them as raw HTML.
Real sites were getting whole `<figure>`, `<dl>` and `<table>` blocks, complete with utility classes and
`data-*` attributes, in their `.md` companions. Figures now become `![alt](src)` with the caption as an
emphasized line, definition lists become a bold term followed by its description, and tables whose cells
are single-span inline content become GFM pipe tables. `time`, `address` and `cite` convert to their text.

Tables with `colspan`, `rowspan` or block content in a cell, and `audio` and `video` (which Markdown cannot
express), stay HTML, reduced to meaningful attributes (`href`, `src`, `alt`, `scope`, `colspan`, `poster`
and similar) with attribute-less `div` and `span` wrappers unwrapped. `keepSelectors` now uses
the same minimization, including when the selected element is the extraction root.

Interface chrome is dropped before conversion: buttons (disclosure toggles with `aria-expanded` or
`aria-controls` stay), `svg`, `template`, `[hidden]` and `[aria-hidden="true"]` elements, unless they wrap
an image with alt text. Extraction diagnostics gain `keptHtmlBlocks`, and the `markdown-html-residue`
audit rule now also flags figures, definition lists and any tag still carrying `class`, `style` or
`data-*` attributes. A separate `markdown-raw-html` warning catches companions with at least
three HTML-containing blocks and either 30 tags or more than 25% tag markup outside code.

### Audit correctness

- Audit directory-format pages using their generated Markdown companion paths instead of looking
  for `index.md` inside each page directory. Companion reads remain confined and symlink-free.
- Resolve same-origin absolute links and hreflang offline using explicit site information or
  generated corpus/domain-profile metadata, without treating external links as local files.
- Preserve live audit reports when response bodies time out or are interrupted, and report failed
  advertised Markdown companions instead of silently skipping them.
- Report missing HTML language attributes during live audits as well as offline audits, while
  preserving noindex exemptions and build-model behavior.

Corrected audits may now report failures that previous versions missed. The `validate` command,
public configuration, and audit report format are unchanged.

### Audit

Add the 1.4 finding contracts. `Finding`, `SourceLocation`, `AuditCategory`, `AuditScores` and
`AuditReportV1` are exported from `astro-aeo`, and the report wire format ships as
`astro-aeo/audit-report.schema.json`. Every existing build diagnostic, validator, sitemap and schema
graph `code` is registered unchanged as a `ruleId` with a category, a usual severity and a help link
into the new `docs/rules.md`. The advisory `astro-aeo-readiness-v1` score weighs an error at 15 and a
warning at 5, caps one rule at 30 points per category, and never affects an exit status. The
`validate` command and its JSON output are unchanged.

Add `astro-aeo audit [distDir|URL]`. It runs every `validate` check and adds site-wide rules for
broken internal links and anchors, duplicate titles, descriptions and canonicals, Markdown companion
quality, JSON-LD validity and hreflang targets, and it reads the build's private diagnostics and
ownership manifests when they are present. Reports render as `terminal`, `json`, `sarif`, `html`,
`markdown`, `github` or `junit` from one deterministic `AuditReportV1`, with `--output`, `--fail-on`,
and `--no-score`. A URL target is crawled anonymously within an origin allowlist, bounded by
`--max-pages`, `--timeout`, `--concurrency`, five redirects and a 5 MiB body cap. Exit codes are `0`
pass, `1` findings at or above the gate, and `2` for a bad invocation or an unreachable target.

`validation.onBuild: 'recommended'` now also gates on the audit rules a build can answer from its page
model. With the default `failOn: 'error'` the one new blocking rule is `markdown-empty`, a Markdown
companion with no text. `'artifacts'` and `'off'` are unchanged, and so is `validate`.

### Deployment: doctor, fix and the GitHub Action

Add `astro-aeo doctor [projectDir]`, which reports how a project is set up to deploy as `configured`,
`missing`, `conflicting` or `unverified`. Local files never earn `configured`: `--url <page>` probes the
deployment anonymously with the same Accept contract the middleware and edge handlers are tested
against, and what the deployment does replaces what the files suggest.

Add `astro-aeo fix [projectDir]`, which makes a static host serve `.md` companions as
`text/markdown; charset=utf-8` by editing `public/_headers` (Cloudflare Pages, Netlify), `vercel.json`
or `render.yaml`, keeping everything else in the file. It is a dry run unless `--write`, backs the
original up under `.astro/aeo-backups/`, is a no-op the second time, and refuses ambiguous providers,
malformed documents, competing rules, symbolic links and paths outside the project. nginx, Apache, Node,
Workers and Deno get a printed snippet. `yaml` becomes a runtime dependency for the `render.yaml` edit
alone and is loaded on demand.

Add a composite GitHub Action at the repository root that audits a build or a URL, uploads SARIF to code
scanning, and reports the exit status after the upload.

Fix a build failure on multilingual sites: the inferred site-wide `WebSite` entity took `inLanguage`
from each page, so two Astro i18n locales conflicted in the merged site graph
(`schema.scalar-conflict`). The shared entity now carries no language on a multilingual site; every
`WebPage` keeps its own, and single-language output is unchanged.

### Static edge negotiation

Add opt-in static edge negotiation for sites without an adapter. `cloudflareEdge()`, `netlifyEdge()` and
`vercelEdge()` (from `astro-aeo/edge/cloudflare`, `/netlify` and `/vercel`) make the build emit
`/.well-known/astro-aeo-edge-v1.json`, listing only the companions it really emitted, and
`createCloudflareHandler()`, `createNetlifyHandler()` and `createVercelHandler()` negotiate from it in
the host's edge layer with the same rules as the Astro middleware: `GET` and `HEAD`, exact routes,
Markdown only when it strictly outranks HTML, `303` in redirect mode, `Vary: Accept` on every listed
route, and the unmodified HTML response whenever the manifest or a companion is missing, malformed or
stale. `astro-aeo/edge` exports the manifest type and the shared decision function. The plugin is
rejected when the project has an adapter, renders a page on demand, or sets `markdown.negotiation` to
`'off'`. The Cloudflare handler is tested in workerd; no handler has been verified on a deployed provider.

Every build now also writes the private `.astro/aeo-cache/deployment-v1.json` (mode `0o600`) with the
output mode, adapter name, base, build format, trailing slash, negotiation mode, edge provider and an
ownership digest. It contains no path and no secret. This private deployment record does not itself
change public artifacts.

### Starlight

Add `astro-aeo/starlight`, a Starlight plugin (`@astrojs/starlight` 0.32 or newer, an optional peer).
`starlightAeo()` registers the integration itself, publishes each docs page's authored Markdown with
asides, tabs and cards as labeled sections, appends previous and next links, and can add a minimal
`TechArticle` entity. MDX it would have to evaluate falls back to the rendered `.sl-markdown-content`
region with the new `authored-source-fallback` diagnostic. An explicit `<AeoPage>` always wins, and the
inferred source is emitted only during collection and removed before anything is written or served.

Fix request-time ownership for catch-all pages. The dots of a rest parameter were read as a file
extension, so a project or integration page at `/[...slug]` rendered on demand owned every `.md`
companion and text artifact path, and those requests answered a bodyless `404`. A rest-parameter page
is now treated like any other generic dynamic page; `/[...slug].json` and dynamic endpoints still own
their paths.

Stop reporting `metadata-conflict` for repeated `<meta name="generator">` tags, which Astro and a
framework built on it each add.

### Content, CMS and versions

Add `astro-aeo/content` with `contentPage`, `contentDescriptor`, `defineContentCatalog` and
`defineCmsAdapter`. They build `<AeoPage>` props and page catalogs from content-collection entries and
headless CMS records, stay loadable by Node, and load through the existing catalog failure isolation.
CMS pages always carry `source.kind: 'cms'` and the source path `cms:<name>:<id>`.

Add `createTechArticle()` to `astro-aeo/schema`.

Add an optional `version` label to `PageDescriptor`, `defineAeoPage`, `AeoPageRecord`, plugin page
records and corpus manifest page entries. It is metadata only; a site without versions produces the same
bytes as before, and an invalid label is ignored with `catalog-invalid-version`.

`defineAeoPage()` is now typed consistently: its JSDoc return type matches the declared `AeoPageProps`.

### Internal

- Run the complete release gate, including performance ceilings, in a read-only, manual W1-Test job
  before tagging. Publication remains exclusive to the strict tag workflow.

- Avoid serializing and reparsing the cleaned content subtree during Markdown conversion. A normalized
  DOM clone preserves selected-root semantics, source labels, and existing Markdown output.

- Documented the plugin `cache: { pure, version }` declaration. It is a build/runtime parity check,
  not a cache: a runtime module whose hooks or declarations differ from the build fails to load and
  its stages isolate, and every hook still runs on every build. Wiring declarations into the
  processing cache remains deferred until a benchmark shows plugin hooks dominating a warm build.
- Covered the dispatcher's cache-declaration validation and its runtime manifest projection, which
  had no tests.

### Package size

Benchmark regression explanation: against the committed 1.3 baseline the published package grows from
272,377 to about 355,650 packed bytes (about 31 percent) and from 1,106,331 to about 1,375,031 unpacked
bytes (about 24 percent; about 18 percent over 1.3.1). 1.4 ships the audit engine with seven report
formats, the doctor and fix commands, the content and Starlight helpers, and three static edge handlers
as new source files. All of it is opt-in and none of it is imported by the integration entry or the
runtime middleware: the Node and Cloudflare bundle comparisons in the same report show no regression,
and startup, memory and request overhead stay under their unchanged ceilings. The accepted tradeoff is
install size for features that need no additional package.

## 1.3.2

### Patch Changes

- c8fa815: Serve development artifacts on projects that redirect their own `/404`. Astro resolves a redirect
  route in its routing layer, before middleware dispatch, so a configuration such as
  `redirects: { '/404/': '/error/' }` answered `llms.txt`, `llms-full.txt`, `robots.txt`,
  `/.well-known/domain-profile.json`, `/llms/manifest.json`, and every `.md` companion with a 301
  instead of reaching Astro-AEO at all. `astro dev` now injects the same fallback routes an adapter
  build already receives for those projects, so the artifact paths have a concrete match. Any other
  `/404`, including none, dispatches middleware on its own and nothing is injected, so development
  servers that already worked are untouched.

  Two behaviors follow for the affected development servers: an unclaimed `.md` path returns a
  bodyless 404 rather than reaching the 404 route, and a companion whose page is prerendered is
  rendered through a loopback request, because Astro forbids an on-demand route from rewriting to a
  prerendered page. A rewrite the loopback rescued is no longer reported as a rewrite failure, for a
  companion and for a corpus page alike, since nothing was dropped. A loopback that never loaded at all
  still names its cause in the terminal rather than leaving every companion of a prerendered page to
  404 silently. Development servers with an adapter gain the same companion fix, where the forbidden
  rewrite previously produced a 404.

  Build output, adapter builds, and server-output promotion are unchanged: a build without an adapter
  still injects nothing, and projects that saw a 301 on `llms.txt` or a `.md` companion in development
  were never affected in production.

  One combination is not covered on Astro 6 and older: a project that also sets
  `trailingSlash: 'always'`. Those versions derive a dynamic route's trailing-slash pattern from the
  project configuration alone, so the injected `.md` catch-all matches `/about.md/` and not
  `/about.md`, and the redirect keeps answering the slashless spelling. The exact artifact paths are
  fixed on every supported Astro, and Astro 7 exempts dynamic endpoint patterns with a file
  extension, so companions work there as well.

- d269d3f: Stand down from injecting a runtime fallback route for an exact artifact path the project already
  routes itself. Astro exposes `injectRoute` only before any route is resolved and has no
  `removeRoute`, so a project page at `src/pages/llms.txt.ts` previously ended up competing with an
  injected route for the same path: Astro warned that a static route was defined twice, and the
  injected route could win the match and answer its bodyless 404 in place of the project's response.
  Injection now checks the project's page files for that one path and skips it, covering every
  supported page and endpoint extension in both the `llms.txt.ts` and `llms.txt/index.ts` spellings.

## 1.3.1

A correctness release that clears the full review backlog raised against 1.3.0. There are no new
features and no configuration changes. Every fix below lands with a test that fails without it.

### Behavior changes worth reading before upgrading

- On multilingual sites, `corpus.index.sections` path rules are now evaluated against the
  locale-relative pathname. A page served at `/de/blog/post` under locale `de` matches as
  `/blog/post`, so one rule applies inside every locale. If you wrote locale-prefixed rules
  against 1.3.0, drop the prefix. Single-locale sites are unaffected, and predicates still
  receive the page with its full `pathname`.
- Static gzip corpus siblings now pin the OS byte alongside MTIME, XFL and the flag byte, so a
  rebuild produces different bytes than 1.3.0 for the same content. The artifacts are
  deterministic across platforms for the first time; `astro-aeo validate` enforces the exact
  header.
- A URL map whose `outputFilepath` lands inside `public/` warns again before overwriting the
  committed file. The warning was lost in 1.2 when the deferred writer became the production
  path, and the overwrite happened silently.
- IndexNow submission never ran in 1.3.0 on Node 20 or newer, which is every supported
  environment. The DNS-pinning transport answered Node's lookup with the legacy single-address
  signature, and the happy-eyeballs connect path (`autoSelectFamily`, on by default since Node 20)
  rejected it, so every HTTPS call in the IndexNow path failed. Under the default non-strict
  policy `astro-aeo indexnow submit` warned and exited 0 without submitting, so the command looked
  like it succeeded. If you enabled IndexNow on 1.3.0, assume no submission ever landed: after
  upgrading, run prepare and submit again to notify the engines about everything published since.
  Any `NODE_OPTIONS=--no-network-family-autoselection` workaround can be removed.

### Correctness

- Answer both lookup contracts from the IndexNow DNS-pinning transport. Node's happy-eyeballs
  path asks with `all` set and expects an array of `{ address, family }`; the legacy path expects
  `(address, family)`. The transport now replies in whichever form was requested. Which address is
  resolved, vetted, and pinned is unchanged, so the SSRF protection is untouched, and the transport
  is now covered end to end through Node's real connect path instead of only through fakes.
- Reserve singleton and generated section slugs globally, so a crafted section title can no
  longer produce two chunks at one pathname.
- Keep IndexNow state advancing when the processing cache is merely disabled. `cache.enabled:
  false` previously reported the cache as read-only and silently stopped IndexNow entirely.
- Reject an unresolved locale group that shares `auto` mode with concrete locales instead of
  publishing a `/null/` path. The guard now reads the same complete locale set that selects the
  corpus topology, so a multi-origin `auto` build can no longer publish a `/null/` directory.
  The shared global artifact is claimed using the complete active-locale count, and per-locale
  companion token counts are keyed by locale.
- Select each locale's own homepage under `corpus.full.mode: 'index'`.
- Resolve rendered `hreflang` against the served URL rather than the canonical URL, canonicalize
  decoded and percent-encoded catalog pathnames into one page identity so overlays apply, and
  fail runtime corpus plans on hreflang validation errors as the build already did.
- Treat prerendered companion lookups as header-unavailable end to end, guard a non-array
  catalog `alternates` value, pass the configured site into development `getStaticPaths()`
  evaluation, freeze plugin alternates handles, and compare runtime cache versions trimmed.

### Development server

Two dynamic route patterns that overlap, such as a `src/pages/[category]/` route with no entries
alongside `src/pages/[...slug].astro`, broke every in-process rewrite to the shadowed route in
`astro dev`. Astro's `findRouteToRewrite` commits to the first route whose pattern matches, and its
only way to reject a route that matches without producing the path reads `route.distURL`, which is
populated only while a build writes files. Ordinary requests and the build were unaffected, but
every page behind the shadowed route silently vanished from `llms.txt`, `llms-full.txt`, and the
schema corpus, and its `.md` companion returned an empty 404 with nothing written to the terminal.

- Failed internal rewrites are recorded instead of discarded. Development warns once per server,
  naming the first affected path, how many others followed, and the cause, and answers an affected
  `.md` request with that reason rather than an empty 404. Production still fails closed, and its
  responses are unchanged.
- Development recovers the page by re-requesting it from the address Astro reported at startup, so
  the corpus and companions stay complete. This is reached only after an in-process rewrite has
  already failed, only for renders that were already anonymous, and it is never present in a
  production or adapter bundle.
- The two development discovery warnings no longer suppress each other. A project with both an
  on-demand dynamic page and `pages.devDynamicDiscovery: false` previously heard about only the
  first of the two.

### Security and validation

- Confine every IndexNow private-state read and write canonically inside the project root, before
  any directory is created, so a symlinked `.astro` or `aeo-cache` can neither redirect queue,
  acknowledgment, or progress data nor materialize directories outside the project. Symlinked
  state files are rejected outright.
- Apply the `keyLocation` prefix check to the decoded, canonicalized pathname and reject encoded
  path separators outright.
- Drop current, acknowledgment, and pending state for origins no longer present in the prepare
  input, with a warning, instead of re-preparing them under the input-wide key and mode.
- Reject localhost, loopback, link-local, and private-address IndexNow origins at configuration
  time, including the fully qualified trailing-dot spellings such as `https://localhost.`, and
  reject whitespace-only or NUL-containing key paths in the published JSON schema.
- Compare the `keyLocation` prefix against the decoded, canonicalized directory, so a key location
  containing a legal escape such as `%20` no longer rejects valid URLs beneath it.
- Carry the complete eligible-origin set into the IndexNow prepare input. Scoping retained cache
  state against the per-origin overrides alone discarded every URL for an Astro i18n domain that
  had no explicit override. `astro-aeo indexnow prepare --source config` recomputes that set from
  the configuration it just loaded, so an origin retired since the build, including an i18n domain
  that never carried an override, is dropped with a warning rather than inheriting the
  input-wide key and submission mode.
- Recognize percent-encoded locale prefixes when computing the locale-relative pathname, so
  section rules and homepage selection work for locales with non-ASCII characters.
- Pass request-header availability through every runtime response path, including plugin artifacts
  and error responses, so prerendered routes never read Astro's blanked request headers.
- Treat robots `Sitemap:` and `# llms.txt:` references as external whenever the local origin
  cannot be proven, rather than failing on an absent local path.
- Percent-encode discovered corpus path segments so encoded robots references match non-ASCII
  locale artifacts.
- Accept `@astrojs/sitemap` `customPages` URLs, so a valid sitemap is still aliased and
  advertised.
- Reject XML comment content ending in a hyphen in strict sitemap parsing.

### Internal

- One canonicalizer and one BCP 47 normalizer for the whole package. IndexNow digests now use the
  validating `canonicalJson`, and the sitemap parser and corpus validator share the build's
  `canonicalLanguage` instead of their own weaker copies.
- A malformed renderer export throws a distinct error, so the build diagnostic names the contract
  violation. An arbitrary import failure stays suppressed because its message can embed paths.
- Removed the unused plugin `cacheIdentities()` API. Plugin cache declarations still gate
  build/runtime consistency; wiring them into the processing cache is planned separately.
- Closed six tests that could not fail, covering the renderer cache guard, five strict sitemap
  findings, IndexNow network-error retries, sitemap alias preservation, adapter build log capture,
  and adapter response-stream errors.

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

- Aligned the JSON schema for `discovery.indexnow[].origin` with runtime validation by
  rejecting non-443 ports, and covered remaining renderer cache-declaration rejection cases.
- Kept a leading thematic break separate from a following setext heading in Markdown block
  planning, preserving both blocks in generated corpora.
- Scoped corpus manifest chunk links by locale, so two pages sharing a pathname across locales
  are no longer credited with each other's chunks.
- Stopped writing a `.md` companion for a catalog page published on another origin. Companions
  are written into this build's own namespace, so two catalog origins sharing a pathname claimed
  the same file under one owner and the later write silently replaced the earlier one. The new
  `catalog-foreign-origin-companion` diagnostic reports each skip.
- Kept the corpus with request-time middleware whenever more than one origin is configured. A
  single emitted corpus is planned against the configured site only, so it cannot be correct for
  every host a multi-domain deployment answers on.
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
