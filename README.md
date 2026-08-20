# Astro-AEO

Answer Engine Optimization and semantic publishing for Astro. One integration, zero config, no
client JavaScript.

Astro-AEO makes your Astro site easy for AI search engines, assistants, and LLMs to discover, parse,
and cite. It generates clean Markdown copies, `llms.txt` indexes, deterministic Schema.org graphs,
crawler policies, and domain identity metadata with no external services or client JavaScript.

It is the Astro sibling of [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).

## What is AEO

Answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews, and others) read your pages to answer questions and cite sources. They do better with clean, structured text than with a page of HTML, scripts, and styles. AEO is the practice of publishing machine-readable companions to your site so those systems can find and quote your content accurately.

A Markdown copy of a page is roughly 20 to 30 percent smaller in tokens than its HTML. An `llms.txt` index of your whole site is a fraction of the size of crawling every page. Smaller, cleaner inputs mean cheaper, more accurate answers that are more likely to cite you.

## Features

- **.md companion pages**: a clean Markdown copy of every page, preserving authored Markdown when available and otherwise extracting from rendered HTML.
- **llms.txt and llms-full.txt**: a site index and a full-content file following the [llmstxt.org](https://llmstxt.org/) spec.
- **Alternate link tags**: `<link rel="alternate" type="text/markdown">` injected into every page so crawlers can find the Markdown.
- **JSON-LD components**: `FaqJsonLd`, `HowToJsonLd`, `BreadcrumbJsonLd`, `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`.
- **Semantic graph**: one deterministic, XSS-safe managed Schema.org graph on every eligible page, with typed builders and integrity validation.
- **Complete head metadata**: `AeoHead` owns canonical, robots, Open Graph, Twitter/X, locale, alternate, feed, pagination, author, and graph output without replacing unrelated authored tags.
- **robots.txt**: allow search and retrieval bots, block training crawlers, with automatic `Sitemap:` and `llms.txt` hints.
- **Sitemap**: auto-wires the official [`@astrojs/sitemap`](https://docs.astro.build/en/guides/integrations-guide/sitemap/), verifies its build output before adding the `robots.txt` hint, and mirrors the index to a conventional `/sitemap.xml` when that target is free.
- **domain-profile.json**: a `/.well-known/domain-profile.json` identity file for authoritative answers about your site.
- **Validator CLI**: `npx astro-aeo validate` checks your build for common AEO mistakes.
- **Dev-server preview**: `llms.txt`, `robots.txt`, and `.md` companions are served live in `astro dev`.
- **Git last-modified**: freshness dates from git history or `article:modified_time`, with zero config.

## Installation

```bash
# with Astro's installer (adds the integration to your config)
npx astro add astro-aeo

# or install manually
bun add astro-aeo
# npm install astro-aeo
```

Astro-AEO requires Astro 5 or newer and Node 20.19.5+. It ships as plain ESM with no build step, so it also works as a git dependency:

```jsonc
// package.json
"dependencies": {
  "astro-aeo": "github:ZAAI-com/Astro-AEO"
}
```

Prefer an AI-assisted install? Paste [`docs/SETUP_PROMPT.md`](docs/SETUP_PROMPT.md) into Claude Code, Cursor, or a similar assistant pointed at your Astro project and it will install and configure Astro-AEO for you.

## Quick Start

Zero config. Add the integration and build:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://yoursite.com',
  integrations: [aeo()],
});
```

```bash
astro build
```

Out of the box you get: a `.md` companion beside every page, `llms.txt` and `llms-full.txt` at the
site root, an alternate link tag, a managed Schema.org graph on each eligible page with a stable
canonical URL, and a sitemap (via the auto-wired `@astrojs/sitemap`). Enable `discovery.robots`,
`site.profile`, `corpus.urlMap`, and the experimental `schema.corpus` outputs when you want them.

## Configuration

All options are optional. Defaults are shown.

```js
aeo({
  site: {
    name: '',                        // llms.txt heading; falls back to profile, <title>, hostname
    description: '',
    defaultLocale: undefined,        // BCP 47 locale used when a page supplies none
    organization: undefined,         // explicit Schema.org entity or { '@id': ... } reference

    profile: {                       // /.well-known/domain-profile.json
      enabled: false,
      name: '',                          // e.g. 'Your Site'
      description: '',                   // e.g. 'What your site is about.'
      website: '',                       // defaults to the Astro `site`
      email: '',                         // '@' -> email, http(s) -> contactPoint, else telephone
      logo: '',
      sameAs: [],
      entityType: 'Organization',        // Organization | Person | Blog | ...
    },
  },

  pages: {
    include: ['**'],                 // path globs to include
    exclude: [],                     // path globs to exclude, e.g. ['/drafts/**']
    respectNoindex: true,            // skip pages with <meta name="robots" content="noindex">
    stripTitleSuffix: false,         // strip " | Your Brand" from titles: string | string[] | RegExp
    devDynamicDiscovery: 'startup',  // 'startup' | 'hot' (experimental) | false
    catalogs: [],                    // request-time inventory and exact descriptor modules
  },

  markdown: {                        // the .md companions
    enabled: true,
    strategy: 'auto',
    renderers: [],                   // importable modules; inline functions are prerender-only
    alternateLink: 'auto',           // 'auto' | 'always' | 'never'
    includeLastModified: true,
    frontmatter: false,              // prepend YAML frontmatter to .md files

    negotiation: 'off',              // 'off' | 'response' | 'redirect', on-demand routes only

    extraction: {
      selectors: ['article', 'main'],     // tried in order, first with a match wins
      removeSelectors: ['nav', 'footer'], // dropped before conversion
      keepSelectors: [],                  // preserved as raw HTML in the Markdown
    },
  },

  corpus: {
    index: {                         // llms.txt
      enabled: true,
      sections: [{ title: 'Home', match: '/' }],  // ordered, first match wins
      defaultSection: 'Pages',       // section for unmatched pages, or false to drop them
      includeDescriptions: true,
      showLastModified: false,
      includeHtmlOnly: false,        // list no-dotmd pages (linking to HTML) instead of omitting them
    },

    full: {                          // llms-full.txt
      enabled: true,
      mode: 'all',                   // 'all' | 'index' | 'first-page-only'
    },

    small: { enabled: false, maxTokens: 20_000 },
    chunks: { enabled: false, maxTokensPerFile: 100_000, by: 'section' },
    manifest: { enabled: false },    // /llms/manifest.json
    tokenizer: undefined,            // { module, options? }; local importable module only
    compression: { gzip: false },    // deterministic static .gz siblings

    urlMap: {
      enabled: false,
      outputFilepath: 'docs/Url-Map.md', // replaced on each enabled, successful build
    },

    runtime: {
      maxPages: 50,                  // positive integer | 'unlimited'; refuses larger live corpora
    },
  },

  i18n: {
    indexes: 'auto',                 // 'auto' | 'global' | 'locale' | 'both'
    unresolvedLanguage: 'default',  // 'default' | 'error' | 'exclude'
  },

  cache: { enabled: true },

  discovery: {
    sitemap: {
      mode: 'auto',                  // 'auto' | 'external' | 'disabled'
      options: {},                   // forwarded when auto-wired; filenameBase also hints user-owned output

      alias: {
        enabled: true,               // mirror the generated index when /sitemap.xml is free
        sourceFilename: 'sitemap-index.xml',  // defaults to the @astrojs/sitemap filenameBase output
        outputFilename: 'sitemap.xml',        // conventional filename written at the build root
      },
    },

    robots: {
      enabled: false,
      policy: 'custom',                  // custom | open | search-open-training-closed | retrieval-only | closed
      universalAllow: true,              // lead with "User-agent: * / Allow: /" (suppressed if '*' is named below)
      allow: [],                          // e.g. ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot']
      disallow: [],                       // e.g. ['GPTBot', 'ClaudeBot', 'Google-Extended']
      includeSitemap: undefined,          // omitted = auto-detect; true = force; false = omit
      sitemapPath: '/sitemap-index.xml',  // defaults to the @astrojs/sitemap output name (tracks filenameBase)
      includeLlmsTxt: true,
      extraLines: [],
      // contentSignals: { search: true, aiInput: true, aiTrain: false },
    },

    indexNow: {
      enabled: false,
      submit: 'changed',              // 'changed' | 'all'
      state: 'public',                // 'public' | 'private' | 'stateless'
      strict: false,
      key: { source: 'env', name: 'ASTRO_AEO_INDEXNOW_KEY' },
      // keyLocation: '/indexnow-key.txt',
      origins: [],
    },
  },

  artifacts: {
    replace: [],                     // exact served pathnames only; no globs
  },

  metadata: {
    fillMissing: false,              // never replaces authored metadata
    defaults: {},                    // explicit fallback values only
  },

  schema: {
    autoInject: true,
    infer: ['website', 'webpage', 'breadcrumbs'],
    strictReferences: true,
    corpus: {
      enabled: false,
      graphPath: '/schema/graph.jsonld',
      mapPath: '/schema/schema-map.xml',
    },
  },

  validation: {
    onBuild: 'artifacts',            // 'artifacts' | 'recommended' | 'off'
    failOn: 'error',                 // 'error' | 'warning'
  },

  plugins: [],
});
```

All 1.3 corpus, i18n, cache, crawler, and IndexNow outputs shown above are implemented. New corpus
families, gzip, crawler presets, Content Signals, and IndexNow remain disabled until configured.
The 1.4 audit, doctor, provider-fix, SARIF, and static edge-negotiation roadmap remains out of scope.

### Migrating to 1.3

Ordinary projects with one implicit locale keep the 1.2 root `llms.txt`, `llms-full.txt`,
Markdown, profile, and custom `robots.txt` bytes. Multilingual projects can choose a topology with
`i18n.indexes`. In `auto`, one active locale remains at the root while multiple locales receive
canonical families under `/<locale>/` and a root language directory. `locale` emits no root
corpus, `global` groups languages at the root, and `both` adds locale families plus flat byte-copy
aliases such as `/llms-en.txt`.

Astro string locale values are the directory identity. Locale objects use `path` as the directory
and `codes[0]` as the primary BCP 47 language. Page language resolves after semantic enrichment.
Invalid explicit declarations are errors; unresolved pages follow `i18n.unresolvedLanguage`.
External public HTTPS `hreflang` links are allowed but never fetched.

The private `.astro/aeo-cache` directory can contain normalized derived page content and IndexNow
notification state. Keep `.astro` uncommitted, transfer the `indexnow` pending and acknowledgment
directory between separate CI prepare/submit jobs, and protect it as sensitive build data. Cache
files use restrictive permissions where supported. `cache.enabled: false` disables payload reuse,
not artifact ownership or IndexNow safety ledgers.

### Migrating to 1.2

Version 1.2 deliberately changes three defaults or public contracts:

- `schema.autoInject` defaults to `true`. Upgrading adds one Astro-AEO-managed JSON-LD graph to
  eligible HTML pages that have a stable canonical URL. Set `schema: { autoInject: false }` to
  retain 1.1 HTML byte behavior. An explicitly rendered `AeoHead` still works when global
  injection is disabled.
- `AeoPageRecord` is now the shared rich page model. It adds route identity, nested metadata,
  source and representation records, dates, authors, entities, directives, extraction details,
  and diagnostics. The existing flat `url`, `mdHref`, `title`, `description`, `markdown`,
  `lastModified`, and `aeoTokens` fields remain as deprecated runtime and type mirrors through
  1.x. The smaller `AeoPage` used by section match predicates is unchanged.
- Project routes and `public/` files now own their served path by default. Astro-AEO will not
  overwrite them unless the exact normalized served pathname appears in `artifacts.replace`.
  Globs are rejected, and duplicate generated claims emit neither claimant. Version 1.2.0 also
  preserved existing project-root URL-map files; 1.3 restores the pre-1.2 behavior and regenerates
  the configured URL map on every successful build when enabled. The served-path ownership flip
  is the other intentional 1.x compatibility exception.

For example, a project that deliberately replaces its own `/docs/llms.txt` under an Astro base of
`/docs` must authorize that exact browser-visible pathname:

```js
aeo({
  artifacts: { replace: ['/docs/llms.txt'] },
  schema: { autoInject: false },
});
```

### Migrating from 1.0

Every 1.0 key still works and produces the same output as its canonical replacement. Using one emits a
single deprecation warning per section; the 1.0 keys are removed in 2.0.

| 1.0 | Canonical 1.x |
| --- | --- |
| `include`, `exclude`, `respectNoindex`, `stripTitleSuffix` | `pages.*` |
| `dotmd.enabled`, `dotmd.includeLastModified`, `dotmd.frontmatter` | `markdown.*` |
| `dotmd.linkTag` | `markdown.alternateLink` |
| `dotmd.dotmdMetadata` | `markdown.frontmatter` |
| `llmsTxt.*` | `corpus.index.*` |
| `llmsTxt.showLastmod` | `corpus.index.showLastModified` |
| `llmsTxt.includeNoDotmd` | `corpus.index.includeHtmlOnly` |
| `llmsFullTxt.*` | `corpus.full.*` |
| `urlMap.*` | `corpus.urlMap.*` |
| `sitemap.enabled: true` / `false` | `discovery.sitemap.mode: 'auto'` / `'external'` |
| `sitemap.options` | `discovery.sitemap.options` |
| `sitemapAlias.*` | `discovery.sitemap.alias.*` |
| `robotsTxt.*` | `discovery.robots.*` |
| `domainProfile.*` | `site.profile.*` |
| `domainProfile.contact` | `site.profile.email` |

To see the canonical replacement for your own config, build once with the printer on:

```bash
AEO_PRINT_MIGRATION=1 astro build
```

It prints a paste-ready block derived from the keys you actually set. Dates and regular
expressions retain executable constructors. Functions appear as `undefined` TODO
placeholders, so copy those callbacks by hand.

Two rules are worth knowing:

- You can mix eras as long as they address different settings. Setting a 1.0 key and
  its canonical replacement to **different** values is a build-stopping error naming both
  paths, because silently picking one could publish the wrong `robots.txt` policy.
- Values compare structurally, but callbacks compare by reference. Pasting the same
  `match` function into both `llmsTxt.sections` and `corpus.index.sections` is
  reported as a conflict: delete one.

`sitemap.enabled: false` maps to `mode: 'external'`, not `'disabled'`. It never meant
"no sitemap", only "do not auto-register `@astrojs/sitemap`"; a sitemap you register
yourself stayed in use. The new `disabled` mode, which has no 1.0 equivalent, opts out
of sitemap handling entirely.

### Sitemap

Astro-AEO does not generate sitemap XML itself; it defers to the official [`@astrojs/sitemap`](https://docs.astro.build/en/guides/integrations-guide/sitemap/) integration, which handles the hard parts (index splitting past 50k URLs, i18n alternates, `lastmod`). With `discovery.sitemap.mode: 'auto'` (the default) and Astro `site` set, Astro-AEO auto-registers `@astrojs/sitemap` when you have not added it yourself. After sitemap generation finishes, Astro-AEO verifies the configured file exists before adding the `Sitemap:` line to `robots.txt`. If filtering, serialization, or an empty site produces no index, the line is omitted instead of advertising a 404.

- Already using `@astrojs/sitemap`? Astro-AEO detects it and stays out of the way (no double registration); your configuration is used as-is.
- Want to tune the auto-registered sitemap? Pass options straight through:

```js
aeo({
  discovery: {
    sitemap: {
      options: {
        changefreq: 'weekly',
        filter: (page) => !page.includes('/drafts/'),
      },
    },
  },
});
```

Set `discovery.sitemap.mode: 'external'` to disable auto-registration. A user-registered sitemap is still detected and finalized. Use `'disabled'` to opt out of sitemap handling entirely, including the alias and the `robots.txt` `Sitemap:` line.

For a separately registered sitemap with a custom `filenameBase`, repeat that value in Astro-AEO as the shared output-name hint. Other `discovery.sitemap.options` are ignored when the user owns the integration, but `filenameBase` keeps the alias source and default robots path aligned:

```js
import sitemap from '@astrojs/sitemap';

integrations: [
  sitemap({ filenameBase: 'docs' }),
  aeo({
    discovery: {
      sitemap: {
        mode: 'external',
        options: { filenameBase: 'docs' },
      },
    },
  }),
],
```

By default `@astrojs/sitemap` names its index `sitemap-index.xml` (a custom `filenameBase` makes it `${filenameBase}-index.xml`), so a request for the conventional `/sitemap.xml` returns 404. With `discovery.sitemap.alias.enabled` (the default), Astro-AEO byte-copies the generated index to `/sitemap.xml` after generation. The copy is byte-identical, but it is created only when the source exists and the target does not. Any existing build output wins, including a file from `public/`, a prerendered Astro endpoint, or another integration. Remove that output if you want Astro-AEO to provide the alias instead.

`discovery.robots.sitemapPath` defaults to the tracked sitemap output name (`/sitemap-index.xml`, or `/${filenameBase}-index.xml`). When `includeSitemap` is omitted, Astro-AEO automatically emits the line only if that path exists in the static build. Set `includeSitemap: true` to force the line for an SSR or runtime-only sitemap, or `false` to suppress it. In `astro dev`, automatic mode recognizes public files and concrete Astro routes but does not advertise the build-only `@astrojs/sitemap` output.

### Giving a page its own source

Astro-AEO reads a page's content out of its rendered HTML. That is a good
approximation, but only an approximation: a heading that was `##` in the source is
an `<h2>` by the time it is served, and the exact wording of a code fence or a
table is gone. When a page is built from Markdown, the page itself still has the
original, and can hand it over:

```astro
---
import { defineAeoPage } from 'astro-aeo/page';
import { AeoPage } from 'astro-aeo/components';
import { getEntry, render } from 'astro:content';

const post = await getEntry('blog', Astro.params.slug);
const aeoPage = defineAeoPage({ source: post });
const { Content } = await render(post);
---
<AeoPage {...aeoPage} />
<Content />
```

`defineAeoPage` reads `body`, `data.title`, `data.description`, image, language, and dates from a
content-collection entry, or accepts explicit authored Markdown/MDX, source kind/path, authors,
Schema.org entities, and directive hints. Every field is optional; supplying none is the same as
not using it at all, and extraction runs as usual.

The marker the component emits is internal. It is written only when Astro-AEO is
the one rendering the page (the build's prerender pass, or a request for the `.md`),
and it is removed from every page before anything is written or served, so it never
reaches a browser and never appears in a `.md` file.

Standalone `.md` page routes need no marker: Astro-AEO reads their source directly,
removes only leading YAML frontmatter, and embeds on-demand sources through a Vite
`?raw` registry in the server bundle. The release bundle-size gate measures this cost.

### Dynamic routes and catalogs

Static builds already give Astro-AEO every concrete pathname returned by a prerendered
route's `getStaticPaths()`. Those pages receive the same `.md`, `llms.txt`,
`llms-full.txt`, schema corpus, and URL-map treatment as file-based pages without a
catalog.

In `astro dev`, `pages.devDynamicDiscovery` controls how aggregate live corpora find
prerendered dynamic paths:

- `'startup'` (default) uses Astro's public route hook to remember the dynamic route
  modules present when the server starts. Astro-AEO imports those modules lazily only
  when an aggregate corpus is requested, then calls their `getStaticPaths()` functions.
  Changes to an existing route module or its content dependencies appear on the next
  corpus request. Adding or deleting an entire dynamic route file requires a restart.
- `'hot'` also tracks dynamic route-file additions and deletions. This mode is
  experimental because it relies on Astro's private `virtual:astro:routes` module,
  whose shape may change between Astro releases. If it becomes incompatible, switch
  back to `'startup'`.
- `false` preserves catalog-only development enumeration. Astro-AEO warns when a
  dynamic page is consequently missing from the development corpus.

Discovery loads only page modules that Astro has resolved as project-owned,
prerendered dynamic routes. Astro-AEO never crawls the site and never parses project
content directories. Props returned with `getStaticPaths()` entries are discarded
immediately and are never placed in a virtual module or corpus. Keep
`getStaticPaths()` deterministic and safe to evaluate during an aggregate corpus
request.

Catalogs remain necessary for on-demand or SSR routes, external CMS-only inventory,
synthetic pages, and any other request-time path that Astro cannot enumerate. They are
also useful when an automatic pathname needs exact authored Markdown or metadata. A
catalog descriptor overlays a matching concrete or automatically discovered path, so
its authored source and metadata win:

```js
// astro.config.mjs
aeo({ pages: { catalogs: [{ module: './src/aeo-catalog.js' }] } })
```

```js
// src/aeo-catalog.js
export default {
  name: 'blog',
  async listPages(context) {
    const posts = await fetchPostsFromYourCms();
    return posts.map((p) => ({
      pathname: `/blog/${p.slug}`,
      rendering: 'on-demand',
      title: p.title,
      markdown: p.markdown,
      lastModified: p.updatedAt,
      sourcePath: `cms:${p.id}`,
    }));
  },
};
```

A catalog that cannot resolve, import, evaluate, or run `listPages()` warns and
contributes nothing rather than failing the build or server startup. Catalogs run in
configured order in both builds and server bundles; the first descriptor wins when
two catalogs name the same normalized path. `context` contains the command, site URL,
base path, and trailing-slash policy.

Catalog entrypoints must be JavaScript that Node's native module loader can execute:
`.js`, `.mjs`, or `.cjs`. This keeps build preflight identical on every supported Node
version. Catalog logic may be authored in TypeScript, but it must be compiled to a
JavaScript entrypoint before Astro loads the integration. Source `.ts`, `.tsx`, `.mts`,
`.cts`, `.jsx`, and `.astro` catalog entrypoints warn and contribute nothing. Node's
built-in TypeScript support is not a portable substitute: it is unavailable on Node 20,
handles only erasable syntax by default, and ignores `tsconfig.json` behavior. See the
[Node TypeScript documentation](https://nodejs.org/api/typescript.html).

Request-time `llms.txt` and `llms-full.txt` render each known route through the
application so page markers behave normally. Each route is rendered serially through
Astro's in-process rewrite pipeline: no network destination is derived from the Host
header, the trusted rewrite capability exists only in process, and caller credentials
are not copied into corpus renders. `corpus.runtime.maxPages` defaults to 50. A larger
corpus returns `503` with `Cache-Control: no-store`, without partial output. Raise the
limit or select `'unlimited'` only when the deployment can safely absorb that work.
Astro 5 and Astro 6.0-6.2 receive `503` for request-time corpora because those
versions do not expose a disposable request state. Their closure-held client address,
cookies, and session cannot be replaced securely for an anonymous corpus render.
Build-time corpus artifacts and authenticated direct `.md` requests are unaffected.
Astro 6.3 and newer use a separate disposable request state for every serialized
corpus render, including streams whose cancellation never settles. This requirement
also applies when a live corpus uses automatic dynamic-route discovery. Ordinary HTML
and direct `.md` requests remain independent of aggregate discovery.

### Content negotiation

`markdown.negotiation` lets a client ask for Markdown at a page's own URL instead of
its `.md` path. `'response'` returns Markdown at the original URL; `'redirect'` sends
a 303 to the `.md` URL. Default is `'off'`.

Markdown has to be asked for explicitly and outrank HTML strictly. A wildcard
(`*/*`), a tie, a missing header, and a malformed one all resolve to HTML, so
browsers, curl, and crawlers that send `*/*` are unaffected. Media parameters must
match the emitted `text/markdown; charset=utf-8` representation. The legacy
`text/x-markdown` type is distinct and does not opt a client into `text/markdown`.

Negotiated responses preserve the page's cache policy, merge `Vary: Accept`, use a
full SHA-256 ETag, and support `HEAD` and `If-None-Match`. A `304` avoids response
bytes but currently still calculates the Markdown representation. A source `304` is
re-evaluated with a sanitized GET only when Markdown is strictly preferred; otherwise
it passes through unchanged. Redirects, API responses, negotiated error pages, and
`204`/`205` responses retain the application's original behavior.
An explicit `.md` request may convert an HTML error body while preserving its status.
Encoded and partial (`206`) HTML responses are not transformed.

**This applies to on-demand routes only.** Astro does not expose request headers to
a prerendered route, deliberately: those pages become static files, so honouring a
request header would work in `astro dev` and then silently stop working once
deployed. A project with no adapter prerenders everything and cannot negotiate
anywhere, and Astro-AEO warns if you configure it there. The `.md` companions are
unaffected and work on any hosting.

### Extraction

`markdown.extraction.selectors` decides which part of a rendered page becomes
Markdown. Selectors are tried in order and the first one with any match wins, so the
default prefers a semantic `<article>` and falls back to `<main>`. If a page has
several top-level matches they are all converted, in document order; a match nested
inside another match is skipped so its content is not emitted twice. With no match,
extraction falls back to `<body>`.

`script`, `style`, `noscript`, `iframe`, and `head` are always dropped, in addition to
`removeSelectors`. `keepSelectors` emits matching elements as raw HTML instead of
converting them, for a widget whose markup carries meaning. Removal wins over
keeping, and the always-dropped tags can never be reintroduced this way.

Figures and captions, definition lists, tables and captions, `time`, `address`, and
`cite` are retained as cleaned raw HTML because flattening them would discard
semantics Markdown cannot express. Empty links and images inherit accessible names
from `alt`, `aria-label`, `aria-labelledby`, then `title`.

Selector options must be arrays. A non-array value, invalid selector, or empty
selector string is a configuration error, not a silent no-op; an empty array is valid.

```js
markdown: {
  extraction: {
    selectors: ['[data-content]', 'article', 'main'],
    removeSelectors: ['nav', 'footer', '.sidebar', '.cookie-banner'],
    keepSelectors: ['.pricing-table'],
  },
}
```

Relative links and image sources in the extracted content are rewritten against the
page's own canonical URL, because a `.md` companion is usually read away from the site
that served it. Fragment links and non-navigational schemes (`mailto:`, `tel:`) are
left exactly as authored.

The same extractor is available to integrations and tooling without importing
Turndown directly:

```js
import { extractHtml } from 'astro-aeo/extract';

const { markdown, diagnostics } = await extractHtml(html, {
  selectors: ['article', 'main'],
}, { baseUrl: 'https://example.com/page/' });
```

### Markdown renderers and optional adapters

`markdown.renderers` extends source-aware Markdown generation. Importable modules default-export
`{ name, apiVersion: 1, render }` and receive immutable page, source, and rendered-HTML input plus
strict JSON options. A renderer can return Markdown, decline, continue with diagnostics, or request
immediate rendered-HTML fallback. Errors diagnose and continue, so a renderer cannot break project
HTML. Inline renderer functions are accepted only for fully prerendered builds.

Astro-AEO also ships two opt-in adapters. Installing an optional peer alone changes nothing:

```js
aeo({
  markdown: {
    renderers: [
      {
        module: 'astro-aeo/mdx',
        options: {
          components: {
            Callout: { action: 'element', name: 'aside' },
            Wrapper: { action: 'unwrap' },
            InteractiveDemo: { action: 'omit' },
          },
        },
      },
      { module: 'astro-aeo/defuddle' },
    ],
  },
});
```

`astro-aeo/mdx` requires optional peer `@mdx-js/mdx`. It parses but never evaluates MDX, removes
ESM, and accepts JSON-only component mappings. Expressions or unsupported semantic JSX fall back
to the already-rendered HTML. `astro-aeo/defuddle` requires optional peer `defuddle`; it processes
only local rendered HTML, forces synchronous mode, blocks fetching, and returns cleaned HTML to
Astro-AEO's core Turndown converter. Missing optional peers warn and retain normal extraction.

### Sections

`corpus.index.sections` groups pages in `llms.txt`. Each rule has a `title` and a `match` that is a glob string, an array of globs, a RegExp, or a predicate `(page) => boolean`. Rules are evaluated in order, first match wins. Empty sections are dropped. Pages matching no rule fall into `defaultSection`.

```js
corpus: {
  index: {
    sections: [
      { title: 'Home', match: '/' },
      { title: 'Guides', match: '/guides/**' },
      { title: 'Blog', match: /^\/\d{4}\/[^/]+$/ },
    ],
    defaultSection: 'Pages',
  },
}
```

Globs are segment-aware: `*` stays inside one path segment, `**` crosses segments and matches the base (`/blog/**` matches `/blog` and `/blog/post`). `/error` matches `/error` but not `/error-log`.

### Small corpora, chunks, manifests, and gzip

`corpus.small` builds a strict token-budgeted `llms-small.txt` from contiguous leading source
blocks. It uses stable round-robin allocation across locales, sections, and pages, counts wrappers
against the limit, and never summarizes or rewrites content. `corpus.chunks` splits full-corpus
content at page, heading, paragraph, and fenced-code boundaries. Fences remain indivisible and an
oversized unit is emitted with a diagnostic rather than silently truncated.

The built-in `astro-aeo-approx@1` counter is deterministic and explicitly approximate. A custom
local tokenizer module must default-export API version 1 with stable `name`, `version`,
`approximate`, and `count()` fields. It is probed twice. Any load or count failure restarts the
whole plan with the built-in tokenizer so a manifest never mixes identities.

When enabled, `/llms/manifest.json` records locales, canonical artifacts, pages, token counts, and
exact SHA-256 byte hashes. Static `corpus.compression.gzip` adds deterministic level-9 siblings for
text corpus artifacts. Runtime middleware serves every logical artifact except precompressed gzip
and relies on provider transport compression.

### Incremental processing cache

Build extraction results and core artifact payloads are content-addressed under
`.astro/aeo-cache/processing-v1`. An exclusive same-host process lock protects reusable state;
invalid, foreign, or active locks force a cold read-only build with no stale deletion authority.
Project routes and `public/` files still win. A stale file is deleted only when the prior ledger
names Astro-AEO, the path is confined, the file is regular and not a symlink, and its bytes still
match the prior emitted hash.

### The universal robots.txt group

`discovery.robots.universalAllow` (default `true`) makes `robots.txt` lead with a `User-agent: *` / `Allow: /` group, so unlisted crawlers see an explicit open policy even when you also name specific bots in `allow`/`disallow`. It is suppressed automatically if you already declare a `User-agent: *` group yourself (via `allow`, `disallow`, or `extraLines`), so there is no duplicate group. Set it to `false` for a named-bots-only policy.

The `custom` policy preserves this renderer. Presets use a frozen, first-party-documented crawler
registry: `open`, `search-open-training-closed`, `retrieval-only`, and `closed`. Per-token
`allow`/`disallow` overrides are case-insensitive and cannot overlap. Content Signals are emitted
only when all three booleans are supplied. Robots policies and experimental Content Signals state
preferences, not access control or guaranteed crawler compliance.

### IndexNow prepare and submit

An enabled build prepares notification state but never submits it. Keys are resolved only by the
submit command from an environment variable or local secret file; literal keys are rejected.

```bash
npx astro-aeo indexnow prepare dist
npx astro-aeo indexnow submit
```

`public` state publishes a key-free `/.well-known/astro-aeo-indexnow-v1.json` and verifies its
deployed digest before submission. `private` uses only the transferred CI acknowledgment ledger.
`stateless` sends all current URLs and cannot notify removals. The default queue is
`.astro/aeo-cache/indexnow/pending-v1.json`.

Submission verifies a same-origin HTTPS key file without redirects, pins public DNS addresses,
batches at 10,000 URLs, and retries network errors, `429`, and `5xx` responses three total times.
Successful batches update acknowledgment state atomically; failed work remains pending. Remote
failures warn with exit 0 unless `strict` is enabled, while malformed invocation, origins,
credentials, or key responses always exit 2. Keys, secret-derived paths, and POST bodies are never
logged or persisted.

### Profile email

`site.profile.email` is routed into the schema.org profile by value shape: an `http(s)` URL becomes a `contactPoint` (`{ '@type': 'ContactPoint', url }`), a value containing `@` becomes `email`, and anything else becomes `telephone`. The old `domainProfile.contact` key is a deprecated alias; it still works but emits a deprecation warning.

### Serving .md companions

On a project with an adapter, `.md` requests are served by Astro-AEO's own middleware,
which sets the content type itself and re-enters your routing, so your own middleware
and its authentication apply to a `.md` request exactly as they do to the HTML.

Configuring an adapter authorizes Astro-AEO to inject on-demand fallback routes for catch-all
`.md` requests and every enabled runtime artifact. This can turn an otherwise static adapter
build into server or hybrid output. The endpoints return `404` when pre-middleware declines and
exist so provider routing reaches that middleware before a custom-404 fallback. Literal project
`.md` routes retain ownership unless their exact served pathname is listed in
`artifacts.replace`.

Release gates build Node, Cloudflare, Deno, Vercel, and Netlify fixtures. Request
contracts run locally for Node, Cloudflare in workerd, Deno, and the emitted Vercel and Netlify
handlers. Separate assertions verify that Vercel routes runtime artifacts to `_render` before its
status-404 fallback and that Netlify does not short-circuit `.md` through bundled custom-404
content.

On static hosting the companions are plain files, and many hosts serve unknown
extensions as `text/plain`, `application/octet-stream`, or a download. To keep answer
engines consuming them as Markdown, set `Content-Type: text/markdown; charset=utf-8`
for `*.md`:

**Render** (`render.yaml`):

```yaml
headers:
  - path: /*.md
    name: Content-Type
    value: text/markdown; charset=utf-8
```

**Netlify / Cloudflare Pages** (`public/_headers`):

```text
/*.md
  Content-Type: text/markdown; charset=utf-8
```

**Vercel** (`vercel.json`):

```json
{
  "headers": [
    {
      "source": "/(.*)\\.md",
      "headers": [{ "key": "Content-Type", "value": "text/markdown; charset=utf-8" }]
    }
  ]
}
```

**nginx**:

```nginx
location ~ \.md$ {
    default_type text/markdown;
    charset utf-8;
    charset_types text/markdown;
}
```

## Per-Page Options

Because Astro-AEO reads the rendered HTML, per-page control is a meta tag. Add one to any page's `<head>`:

```html
<meta name="aeo" content="skip" />         <!-- exclude from everything -->
<meta name="aeo" content="no-dotmd" />     <!-- no .md companion -->
<meta name="aeo" content="no-llms" />      <!-- keep out of llms.txt and llms-full.txt -->
<meta name="aeo" content="no-llms-full" /> <!-- keep out of llms-full.txt only -->
```

Pages with `<meta name="robots" content="noindex">` are skipped automatically unless you set `respectNoindex: false`.

## AeoHead and managed metadata

`AeoHead` is the primary interface for metadata and one managed graph script. Place it inside the
page's `<head>`:

```astro
---
import { AeoHead } from 'astro-aeo/components';
import { createArticle, createGraph, createId } from 'astro-aeo/schema';

const canonical = new URL(Astro.url.pathname, Astro.site);
const article = createArticle({
  '@id': createId('#article', canonical),
  headline: 'A stable semantic page',
  datePublished: '2026-08-11T09:30:00+02:00',
  dateModified: '2026-08-18T12:00:00Z',
});
const graph = createGraph([article]);
---
<head>
  <AeoHead
    title="A stable semantic page"
    description="Metadata and JSON-LD from one component."
    canonical={canonical}
    openGraph={{ type: 'article' }}
    twitter={{ card: 'summary' }}
    graph={graph}
  />
</head>
```

For Article rich results, [Google prefers](https://developers.google.com/search/docs/appearance/structured-data/article)
ISO 8601 datetimes with timezone information for `datePublished` and `dateModified`, such as an
explicit offset or a `Z` suffix. A bare ISO date such as `2026-08-11` remains a valid
[Schema.org `Date`](https://schema.org/datePublished), but Google's Rich Results Test may report
non-critical date warnings. These warnings do not affect eligibility. Astro-AEO passes each
authored value through unchanged without normalizing it or adding a timezone.

Its typed props cover `title`, `description`, `canonical`, `robots`, `openGraph`, `twitter`,
`locale`, `hreflang`, `feeds`, `pagination`, `markdownAlternate`, `themeColor`, `authors` (`author`
remains a 1.x alias), `graph`,
and `infer`.

An explicit component works even when `schema.autoInject` is false. `infer={false}` disables
inference for that page while retaining its explicit metadata and graph. Canonicals resolve in
this order: explicit `AeoHead`, one valid authored canonical, then Astro `site` plus the normalized
route. Astro-AEO never derives graph identity from localhost or an arbitrary request host. If no
stable canonical exists, the page is preserved, managed graph output is skipped, and one warning
explains how to fix it.

Explicit property families replace only the tags they own. Omitted families leave authored bytes
alone. `metadata.fillMissing: true` can add only absent canonical, `og:title`, `og:description`,
`og:url`, and explicitly configured defaults. It does not invent images, authors, publishers, or
robots policies. Supported defaults are `title`, `description`, `robots`, `openGraph`, `twitter`,
`locale`, `themeColor`, and `author`; each value must be explicit JSON data. Existing JSON-LD
scripts are inspected for graph assembly but never rewritten.

## Schema graph API

`astro-aeo/schema` provides pure graph helpers and full public vocabulary types from `schema-dts`:

```js
import {
  connect,
  createGraph,
  createId,
  createOrganization,
  createWebSite,
  ref,
  serializeGraph,
  validateGraph,
} from 'astro-aeo/schema';

const organization = createOrganization({
  '@id': createId('https://example.com/#organization'),
  name: 'Example',
});
const website = connect(
  createWebSite({ '@id': createId('https://example.com/#website'), name: 'Example' }),
  'publisher',
  ref(organization),
);
const graph = createGraph([organization, website]);
const result = validateGraph(graph, { siteUrl: 'https://example.com/' });
const jsonLd = serializeGraph(result.graph, { siteUrl: 'https://example.com/' });
```

The package exports builders for `WebSite`, `WebPage`, `Person`, `Organization`, `Article`,
`BlogPosting`, `BreadcrumbList`, `ImageObject`, `VideoObject`, `Product`,
`SoftwareApplication`, `Service`, `Offer`, `FAQPage`, `HowTo`, `Event`, and `LocalBusiness`, plus
`createEntity`, `createGraph`, `createId`, `ref`, `connect`, `mergeGraph`, `deduplicateGraph`,
`validateGraph`, and `serializeGraph`.

User-authored IDs win. Equal-ID objects merge recursively, arrays deduplicate in semantic order,
and scalar conflicts error unless `first` or `last` is explicitly selected. Same-document
references must resolve, known same-site references can resolve across collected pages, and
external IDs remain valid without fetching. Provenance and conflict values remain outside emitted
JSON-LD, and serialization is deterministic and safe for an inline script.

`createId` is the boundary that returns a branded, absolute identifier. Entity builders and
`createEntity` may retain relative IDs and URL properties while a graph is being assembled;
`validateGraph` resolves them against its explicit `documentCanonical` and returns the normalized
graph. No request host is used as an implicit base.

### Experimental schema corpus

Set `schema.corpus.enabled: true` to emit the atomic pair `/schema/graph.jsonld` and
`/schema/schema-map.xml`, or choose other exact paths. These files are experimental,
Astro-AEO-specific discovery aids, not Schema.org, Google, or other standards. Their presence does
not imply search-feature eligibility. JSON-LD retains anonymous entities; the XML map omits them
with a diagnostic because it can list only stable IDs.

Both corpus paths must use one exact, normalized, app-relative URL spelling below `/`: no query,
fragment, glob, dot segment, encoded separator, ambiguous encoding, duplicate slash, or trailing
slash. Cross-page reference validation is scoped to the configured Astro site and `base` path.

Runtime schema corpora use the same anonymous, serial, in-process renderer as the text corpora,
including `GET`, `HEAD`, ETags, and conditional requests. Astro 5 and Astro 6.0 through 6.2 return
`503` with `Cache-Control: no-store` for full request-time corpora. Astro 6.3 or newer is required
for disposable per-page request state.

## Plugin API

Plugins use the stable API version 1 object at the package root:

```js
const plugin = {
  name: 'example-metadata',
  apiVersion: 1,
  setup(api) {
    api.on('page:metadata', ({ value }) => ({ action: 'keep' }));
    api.claimArtifact({ id: 'feed', pathname: '/answer-feed.txt' });
  },
  runtime: {
    entrypoint: new URL('./src/aeo-runtime-plugin.js', import.meta.url),
    options: { label: 'Answers' },
  },
};

aeo({ plugins: [plugin] });
```

Hooks run sequentially in configured order through `page:discovered`, `page:extract`,
`page:transform`, `page:metadata`, `graph:build`, `artifact:generate`, `artifact:validate`, and
`build:complete`. Inputs are immutable; a hook keeps, replaces, or isolates its current scope.
Runtime modules use literal entrypoints and strict JSON options. Omitting runtime `options` leaves
`api.options` undefined, while an explicit JSON `null` remains `null`. Graph replacements are
reconciled with unchanged authored JSON-LD before Astro-AEO regenerates its one managed script, so
build and runtime corpora use the same final graph. Artifact claims are exact
app-relative pathnames, and runtime page access never exposes raw requests, cookies, credentials,
or arbitrary rendering. The built-in semantic pipeline uses this same dispatcher.

## JSON-LD Components

Import from `astro-aeo/components` and drop into any layout or page.

```astro
---
import { FaqJsonLd, BreadcrumbJsonLd, ArticleJsonLd } from 'astro-aeo/components';
---
<FaqJsonLd items={[{ question: 'What is AEO?', answer: 'Answer Engine Optimization.' }]} />
<BreadcrumbJsonLd />
```

| Component | Props | Notes |
| --- | --- | --- |
| `FaqJsonLd` | `items: { question, answer }[]` | FAQPage |
| `HowToJsonLd` | `name`, `steps: { name, text, url?, image? }[]`, `description?`, `totalTime?` | HowTo |
| `BreadcrumbJsonLd` | `items?`, `labels?`, `includeHome?` | Auto-derives the trail from the URL when `items` is omitted |
| `OrganizationJsonLd` | `name`, `url?`, `logo?`, `sameAs?`, `contactEmail?` | `url` defaults to `site`. Place once, e.g. the homepage |
| `SpeakableJsonLd` | `cssSelector?` (default `['main']`), `url?` | Drop-in with no props |
| `ArticleJsonLd` | `headline`, `datePublished?`, `dateModified?`, `author?`, `image?`, `description?` | For posts and dated content. Google prefers ISO 8601 datetimes with an offset or `Z`; values pass through unchanged |

Each compatibility component renders a single, XSS-safe `<script type="application/ld+json">`.
They use the graph builders internally while preserving their established props and serialized
output. New semantic pages should prefer `AeoHead` and `astro-aeo/schema`.

## Validator CLI

```bash
npx astro-aeo validate            # validates ./dist
npx astro-aeo validate dist --strict --json
```

Checks: corpus topology is discovered from its manifest or the filesystem; locale families,
canonical selections, page/chunk/artifact hashes, token counts, aliases, and gzip siblings are
verified. The validator also checks strict sitemap indexes and confined shards, Markdown links,
alternate metadata, robots references, page metadata, and domain profiles. Standalone validation
does not import arbitrary project tokenizer code.

Exit codes: `0` pass, `1` validation errors (or warnings with `--strict`), `2` usage or IO error.

## How It Works

Astro-AEO hooks into Astro's standard integration lifecycle. Build and runtime processing share the
same staged discovery, extraction, normalization, metadata, graph, validation, and artifact logic.
On `astro build`, generated files and targeted HTML enrichments are buffered until validation and
ownership checks finish, then committed atomically. No separate package build step, external
service, or network self-fetch is required. Redirect stubs and non-HTML outputs are skipped.

In `astro dev`, a middleware serves `robots.txt`, `domain-profile.json`, and `.md` companions live, and builds `llms.txt` from your static routes. Dev is best-effort: dynamic and content-collection routes are only fully enumerated by a build, so the dev `llms.txt` carries a note to that effect and the build output remains the source of truth.

Last-modified dates come from `<meta property="article:modified_time">` when present, otherwise from the git commit history of a static route's source file. Emit `article:modified_time` for precise dates on content-collection pages.

## Development

```bash
pnpm install
pnpm test              # colocated unit + CLI + build e2e tests (Vitest)
pnpm run test:watch    # Vitest in watch mode
pnpm run test:dev      # dev-server e2e (spawns astro dev)
pnpm run typecheck     # tsc --noEmit against JSDoc types
pnpm run test:types    # public declarations on the TypeScript 5.5 floor
pnpm run demo:dev      # run the demo site in fixtures/demo
pnpm run demo:build    # build the demo site
pnpm run demo:validate # run the validator CLI on the demo build
pnpm run test:ssr      # adapter e2e (builds and boots @astrojs/node)
pnpm run test:trailing # always/never/ignore under a base path on the Node adapter
pnpm run test:adapters # build five adapters; request-test Node, workerd, and Deno
pnpm run release:check # schema, compatibility, tarball, adapters, and benchmarks
```

Tag publication adds `--require-clean`, checks that the numeric tag equals the package and changelog
version, and refuses a dirty checkout before the packed-tarball and provider gates run. Both pull
requests and tagged publication also run real pinned Node servers on Astro 5.18, 6.2, 6.3, and 7.

Tests are colocated next to the source they cover as `*.test.js`. The frozen
`fixtures/golden-1.0` output proves static byte compatibility with the actual 1.0
implementation, while `fixtures/config-compat` compares legacy and canonical option
spellings. The package is authored as plain ESM JavaScript with JSDoc types and a
hand-written `index.d.ts`, so it needs no build step and installs cleanly as a git dependency.

Working on this repo with an AI agent? See [`AGENTS.md`](AGENTS.md) for the architecture, conventions, and test workflow. Notable changes are tracked in [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT (c) 2026 ZAAI. Built and maintained by [ZAAI](https://zaai.com). Sibling project: [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).
