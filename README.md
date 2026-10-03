# Astro-AEO

Answer Engine Optimization and semantic publishing for Astro. One integration, zero config, no
client JavaScript.

Astro-AEO makes your Astro site easy for AI search engines, assistants, and LLMs to discover, parse,
and cite. It generates clean Markdown copies, `llms.txt` indexes, deterministic Schema.org graphs,
crawler policies, and domain identity metadata with no external services or client JavaScript.

It is the Astro sibling of [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).

> **New in 1.5: [EmDash CMS](#emdash-cms) support.** Running a site on
> [EmDash](https://emdashcms.com/)? Add `emdashAeo()` and every published post, page, and project
> gets a Markdown copy and a place in `llms.txt`, updated within seconds of publishing. It works
> with the Blog, Marketing, Portfolio, and Starter templates, on Node and Cloudflare.

## What is AEO

Answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews, and others) read your pages to answer questions and cite sources. They do better with clean, structured text than with a page of HTML, scripts, and styles. AEO is the practice of publishing machine-readable companions to your site so those systems can find and quote your content accurately.

A Markdown copy of a page is roughly 20 to 30 percent smaller in tokens than its HTML. An `llms.txt` index of your whole site is a fraction of the size of crawling every page. Smaller, cleaner inputs mean cheaper, more accurate answers that are more likely to cite you.

## Features

- **EmDash CMS**: `emdashAeo()` lists every published EmDash entry at its public URL and keeps `llms.txt` current as editors publish, on Node and Cloudflare. See [EmDash CMS](#emdash-cms).
- **Starlight**: `starlightAeo()` adds Astro-AEO to a Starlight docs site as a plugin. See [Starlight](#starlight).
- **.md companion pages**: a clean Markdown copy of every page, preserving authored Markdown when available and otherwise extracting from rendered HTML.
- **llms.txt and llms-full.txt**: a site index and a full-content file following the [llmstxt.org](https://llmstxt.org/) spec.
- **Alternate link tags**: `<link rel="alternate" type="text/markdown">` injected into every page so crawlers can find the Markdown.
- **JSON-LD components**: FAQ, how-to, breadcrumb, organization, speakable, article, product, software application, review, item list, dataset, profile page, service, and local business.
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

Using EmDash or Starlight? Use [`emdashAeo()`](#emdash-cms) or [`starlightAeo()`](#starlight)
instead of `aeo()`; each registers Astro-AEO with the right defaults for that framework.

## EmDash CMS

**New in 1.5.** [EmDash](https://emdashcms.com/) is a full-stack CMS built on Astro: content lives
in a database, editors publish in an admin at `/_emdash/admin`, and every page renders on demand.
Astro-AEO supports it with one line. `emdashAeo()` finds every published post, page, and project,
serves a Markdown copy of each, lists them in `llms.txt` and `llms-full.txt`, and picks up new
entries within seconds of publishing, with no rebuild. It works with every EmDash template (Blog,
Marketing, Portfolio, and Starter), with sites that mix them, and on Node and Cloudflare.

Install it in your EmDash project, then add `emdashAeo()` next to `emdash()` instead of `aeo()`:

```bash
npm install astro-aeo   # not `astro add`, which would insert a plain aeo()
```

```js
// astro.config.mjs
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import emdashAeo from 'astro-aeo/emdash';

export default defineConfig({
  site: 'https://example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    emdash({ database: sqlite({ url: 'file:./data.db' }), storage: local({ /* ... */ }) }),
    emdashAeo(),
  ],
});
```

Publish a post in the admin, and a few seconds later your site answers with it:

```text
$ curl https://example.com/llms.txt
# My Blog

- [The Case for Static](/posts/the-case-for-static.md): Static sites aren't a step backwards.
- [About](/pages/about.md)
- [Development](/category/development.md): All posts in the Development category.

$ curl https://example.com/posts/the-case-for-static.md
# The Case for Static
...
```

It registers Astro-AEO for you with these defaults. Anything you pass as `emdashAeo({ aeo: { ... } })`
wins, and your own `pages.exclude` and `pages.catalogs` entries come first:

| Setting | Default | Why |
|---|---|---|
| `pages.exclude` | adds `/_emdash/**` and `/404` | the admin, API, and 404 page are not content |
| `pages.catalogs` | adds the EmDash catalog, `revalidate: 10` | EmDash pages exist only at request time |
| `markdown.negotiation` | `'response'` | every EmDash page renders on demand |
| `discovery.robots.enabled` | `false` | EmDash serves its own `robots.txt` |
| `discovery.sitemap.mode` | `'disabled'` | EmDash serves its own sitemaps |

The catalog lists every published entry of every collection that has a URL pattern, at the URL
EmDash itself builds from that pattern (`{slug}`, `{id}`, and the date tokens `{year}` to `{second}`).
It follows EmDash's sitemap rules: collections with SEO turned off, drafts, deleted entries, entries
without a slug, and entries marked noindex in the SEO panel are left out. A collection without a
URL pattern, such as the Marketing template's `pages`, is skipped because fixed routes (`/`,
`/pricing`) render it, and Astro-AEO already knows those. The catalog reads EmDash through its
public read API from your own `emdash` install, so it works with any EmDash database and never
opens one itself. Entries you publish appear within
`revalidate` seconds without a restart.

### Options

```js
emdashAeo({
  collections: {
    posts: { section: 'Blog' },                          // an llms.txt heading; URLs from the seed urlPattern
    pages: { section: { title: 'Pages', match: ['/about', '/team'] } },
    legal: false,                                        // keep a collection out of the corpora
  },
  taxonomies: { category: '/category/{slug}', tag: '/tag/{slug}' }, // archive routes to list
  revalidate: 10,                                        // seconds; 0 = every request, false = once per process
  maxEntries: 50000,                                     // matches EmDash's sitemap limit
  aeo: { pages: { exclude: ['/search'] } },              // any Astro-AEO option
})
```

A string `section` takes its URLs from the collection's `urlPattern` in the seed file named by
`package.json` (`/posts/{slug}` matches `/posts/**`). A pattern that starts at the site root, such as
`/{slug}`, needs an explicit `match`. EmDash stores no URL for a taxonomy, so archive pages are listed
only when `taxonomies` names their route, and only for terms that have published entries.

### What each template gets

| EmDash template | Listed automatically | Options worth setting |
|---|---|---|
| Blog | `/posts/*`, `/pages/*` | `taxonomies` for `/category/*` and `/tag/*`; exclude `/search` |
| Marketing | `/`, `/pricing`, `/contact` (fixed routes) | none |
| Portfolio | `/work/*`, `/about` | none |
| Starter | `/posts/*`, root pages such as `/about` | `taxonomies` |
| Your own mix | every collection with a URL pattern | `collections` for `llms.txt` sections or to leave one out |

Each row has a complete, tested project under [`recipes/`](recipes/): `emdash-blog`,
`emdash-marketing`, `emdash-portfolio`, `emdash-starter`, the mixed `emdash` site, and
`emdash-cloudflare`.

### Things to know

- `emdashAeo()` throws if `aeo()` is also registered, or if `emdash()` is missing. It accepts the
  current option names only, and it cannot enable IndexNow: the build has no page inventory for an
  EmDash site, so IndexNow would read every page as removed.
- With i18n enabled, the catalog lists the default locale only and warns once. Describe translated
  entries in a catalog of your own.
- Aggregate files are origin-scoped in production: a deployed server answers `llms.txt` for the
  configured `site` origin, not for arbitrary `Host` headers.
- Request-time corpora need Astro 6.3 or newer, and EmDash needs Node 22.16 or newer.
- On Cloudflare the catalog reads D1 through EmDash's own per-request session, so the options are
  the same as on Node. [`emdash-cloudflare`](recipes/emdash-cloudflare/) runs the mixed site in
  workerd on a local D1 database.

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
      origins: {},                       // origin-keyed overrides of profile fields (not enabled)
    },
  },

  pages: {
    include: ['**'],                 // path globs to include
    exclude: [],                     // path globs to exclude, e.g. ['/drafts/**']
    respectNoindex: true,            // skip pages with <meta name="robots" content="noindex">
    stripTitleSuffix: false,         // strip " | Your Brand" from titles: string | string[] | RegExp
    devDynamicDiscovery: 'startup',  // 'startup' | 'hot' (experimental) | false
    catalogs: [],                    // request-time inventory and exact descriptor modules; { module, revalidate? }
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
      keepSelectors: [],                  // preserved as minimized HTML in the Markdown
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
    versions: undefined,             // { current: 'v2', order: ['v1'] }; opt-in partitions
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
The 1.4 `audit` command and its SARIF, JUnit, HTML, Markdown, and GitHub report formats are implemented
(see [Audit](#audit)), and so are [static edge negotiation](#static-edge-negotiation) and the
[`doctor` and `fix`](#doctor-and-fix) deployment commands.

`validation.onBuild` decides what can fail a build, at the severity chosen by `validation.failOn`:

- `'artifacts'` (default): diagnostics raised while generating and writing artifacts.
- `'recommended'`: the above, plus each page's own diagnostics (extraction, renderer, metadata), plus
  the audit rules a build can answer from its page model: `markdown-empty`, `markdown-thin`,
  `markdown-no-h1`, `markdown-html-residue`, `description-missing`, and the `title-duplicate`,
  `description-duplicate` and `canonical-duplicate` checks. Only `markdown-empty` is an error, so with
  the default `failOn: 'error'` a page whose companion has no text is what newly stops a build. Link,
  anchor and hreflang rules need the rendered site and run only in `astro-aeo audit`.
- `'off'`: nothing optional. Artifact integrity errors that would corrupt output still stop the build.

### Migrating to 1.4

1.4 adds features and changes no configuration key. A project that uses none of them emits the same
public files as 1.3.2. Four behaviors are worth knowing before you upgrade:

- `validation.onBuild: 'recommended'` also gates on the audit rules a build can answer from its page
  model. With the default `failOn: 'error'`, the one new blocking rule is `markdown-empty`: a Markdown
  companion with no text, such as a page whose content is only an image. `'artifacts'` and `'off'` are
  unchanged.
- A catch-all page rendered on demand (`src/pages/[...slug].astro`, or an integration's equivalent) no
  longer owns every `.md` companion and text artifact path. Those requests answered a bodyless `404`
  before and are served now. `/[...slug].json` and dynamic endpoints still own their paths.
- On a site with more than one Astro i18n locale, the inferred site-wide `WebSite` entity no longer
  carries `inLanguage`. Each page would otherwise claim its own language for the one shared entity, and
  the merged site graph failed the build with `schema.scalar-conflict`. Every `WebPage` keeps its
  language, and single-language sites are unchanged.
- Repeated `<meta name="generator">` tags no longer report `metadata-conflict`.

Every build also writes a private `.astro/aeo-cache/deployment-v1.json` beside the existing manifests. It
holds names and modes only and is never published.

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
External public HTTPS `hreflang` links are allowed but never fetched. Plain `http:` alternates are
accepted only on `localhost`, `127.0.0.1` and `[::1]`, and only while the page is served from one of
those hosts or `astro dev` or `astro preview` is running, so a production build still rejects a
stray local link.

The private `.astro/aeo-cache` directory can contain normalized derived page content and IndexNow
notification state. Keep `.astro` uncommitted, transfer the `indexnow` pending and acknowledgment
directory between separate CI prepare/submit jobs, and protect it as sensitive build data. Cache
files use restrictive permissions where supported, and the extraction cache resets itself when the
extractor changes (see [Incremental processing cache](#incremental-processing-cache)).
`cache.enabled: false` disables payload reuse, not artifact ownership or IndexNow safety ledgers.

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

`defineAeoPage` reads `body`, `data.title`, `data.description`, image, language, version, and dates from a
content-collection entry, or accepts explicit authored Markdown/MDX, source kind/path, authors,
Schema.org entities, and directive hints. Every field is optional; supplying none is the same as
not using it at all, and extraction runs as usual. The `body` of an `.mdx` entry is never used as
Markdown, because it holds imports and JSX: a registered `astro-aeo/mdx` renderer converts it, and
without one the page's rendered HTML is extracted.

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
- `false` preserves catalog-only development enumeration. When a project has a dynamic
  page route and no `pages.catalogs` module, Astro-AEO warns that the development corpus
  is incomplete.

Enumeration is only half the job: a discovered path still has to render. When two dynamic
route patterns both match a path and the one Astro sorts first does not produce it,
Astro's development server cannot reach the right route through an internal rewrite. A
`src/pages/[category]/` route with no entries alongside `src/pages/[...slug].astro` is the
common shape. Ordinary requests are unaffected, and so is the build.

Astro-AEO recovers in development by re-requesting that one page from the address the
development server reported at startup, so the corpus and `.md` companions stay complete.
This is the single exception to the request-time rule that no network destination is
derived from a request: the destination is Astro's own bound address, never a header, the
transport exists only in `astro dev`, and it is reached only after an in-process rewrite
has already failed. If the fallback is unavailable, Astro-AEO names the incomplete corpus
in the terminal and answers the affected `.md` request with the reason instead of an empty
404. Catalogs do not work around this, because a catalog supplies pathnames and pathnames
were never the missing piece.

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

### Content and CMS helpers

`astro-aeo/content` removes the boilerplate above. Every helper is plain data in, plain data out, so a
catalog built with them is still loadable by Node before Vite exists (a catalog module cannot import
`astro:content`; read a JSON export, a file glob, or an index your project builds).

```js
// src/aeo-catalog.js
import { defineCmsAdapter } from 'astro-aeo/content';

export default defineCmsAdapter({
  name: 'sanity',
  async listPages() {
    const posts = await fetchPostsFromYourCms();
    return posts.map((p) => ({ id: p.id, pathname: `/blog/${p.slug}`, title: p.title, markdown: p.markdown }));
  },
});
```

- `contentPage(entry, overrides?)` returns `<AeoPage>` props from a content-collection entry. It is
  `defineAeoPage({ source: entry, ...overrides })`.
- `contentDescriptor(entry, { pathname, ...overrides })` returns a serializable catalog descriptor from
  an entry: title, description, image, language, version, dates, Markdown body, and source path. An
  `.mdx` body is carried as `source.body` for a registered renderer instead of as Markdown.
- `defineContentCatalog({ name?, entries, toPage })` builds a catalog. `entries(context)` loads your
  entries and `toPage(entry, context)` returns `{ pathname, ...overrides }`, or `null` to leave one out.
- `defineCmsAdapter({ name, listPages })` builds a catalog whose pages always carry
  `source.kind: 'cms'` and the source path `cms:<name>:<id>`, whatever the adapter reported. Fetching,
  credentials, and caching stay in your adapter; Astro-AEO adds no network access.

These catalogs load through the same failure isolation as a hand-written one: a catalog that throws
warns, records `catalog-load-failed`, and contributes nothing.

### EmDash

EmDash sites use `emdashAeo()` instead of `aeo()`, with a catalog that lists every published entry.
See [EmDash CMS](#emdash-cms).

### Privacy-first request analytics

Analytics is disabled by default. On an observable on-demand Astro middleware surface:

```js
aeo({ analytics: { enabled: true, scope: 'agents', sampleRate: 1,
  adapter: { type: 'console' }, strict: false } })
```

Only public in-base GET/HEAD requests are observed. Collection, prerendering, anonymous
corpus fan-out and development loopback requests are excluded. `agents` includes AEO
artifact requests and claimed crawler HTML requests; `all` explicitly includes ordinary
traffic. Events use minute-rounded UTC, configured inclusion rates and the versioned
crawler registry. User-Agent classifications are **claims, not verified identities**.
Known paths take priority over declared route patterns, then `(unlisted)`; route parameter
values and arbitrary requested paths are never logged. IP, query, referrer, cookies,
authorization, raw request headers and response bodies are not collected. Cache outcomes
are `not-modified` for HTTP 304 or `unknown`, never an inferred provider hit/miss.

The `astro-aeo/analytics` export includes `AnalyticsEventV1` (and `astro-aeo/analytics-event.schema.json`), `AnalyticsAdapterModule`,
`createAnalytics`, `createConsoleSink`, `createWebhookSink` and `createOpenTelemetrySink`.
Console events start with `astro-aeo:analytics-v1 `. Development always uses console,
including when another sink is configured. Disabled and omitted analytics have identical
analytics-free server bundles. No browser script is installed.

Delivery options:

| Adapter | Configuration and constraints |
| --- | --- |
| `console` | Default; marked one-event JSON lines. |
| `jsonl` | Node adapter, Node-based development or preview only (not workerd/Deno); default `.astro/aeo-analytics/events-v1.jsonl`, mode `0600`, serialized appends, no symlinks or paths escaping the project. |
| `webhook` | `{ type: 'webhook', url: 'https://events.example.test', headers: { Authorization: { env: 'EVENT_TOKEN', prefix: 'Bearer ' } } }`; secrets resolved at request time, one-event envelopes, redirects rejected, two-second timeout. |
| `opentelemetry` | An HTTPS `endpoint` for OTLP/HTTP JSON, or separately installed optional `@opentelemetry/api` peer. Counters have bounded attributes, never path attributes. Edge helpers can inject a meter-backed sink. |
| `module` | `{ type: 'module', module: './analytics.mjs', options: { ... } }`; strict JSON options and a default export `{ apiVersion: 1, createSink(options) }` returning a function `(event) => void | Promise<void>`. Setup is preflighted. |

Strict preflight failures reject configuration; non-strict failures disable delivery with
sanitized advice. Runtime failures are caught and reported once (strict: error; otherwise:
warning), never propagated into HTTP. Supported provider request-lifetime callbacks retain
pending delivery. Without a callback, delivery is caught fire-and-forget and is best effort.
Runtime module loading/setup failures disable delivery without preventing HTTP responses.
Module sinks receive only sanitized events and are responsible for their own runtime portability.

A static deployment must explicitly declare an edge plugin and inject the observer into its
handler. Integration configuration **does not install deployment middleware**. For example,
with the Cloudflare edge plugin already configured:

```js
import { createCloudflareHandler } from 'astro-aeo/edge/cloudflare';
import { createAnalytics, createWebhookSink } from 'astro-aeo/analytics';

const handlers = new WeakMap();
export default {
  fetch(request, env, context) {
    if (!handlers.has(env)) {
      const analytics = createAnalytics({ enabled: true, base: '/docs',
        inventory: ['/docs/guide'], artifacts: ['/docs/guide.md', '/docs/llms.txt'],
        sink: createWebhookSink({ url: 'https://events.example.test',
          headers: { Authorization: { env: 'EVENT_TOKEN', prefix: 'Bearer ' } },
          secret: (name) => env[name] }),
      });
      handlers.set(env, createCloudflareHandler({ base: '/docs', analytics }));
    }
    return handlers.get(env).fetch(request, env, context);
  },
};
```

Cloudflare Pages/Workers and Netlify use supplied context lifetimes; Vercel accepts
`waitUntil` alongside its `next`/`rewrite` helpers. These observers report only traffic
reaching their declared surface, not whole-host logs or verified visitors. Vercel observations
are routing-middleware responses, not the final origin status. Prerendered HTML served directly
by an asset layer does not pass through Astro middleware. Provider checks are local contracts,
not deployed verification. Analytics with no observable on-demand route and no declared edge
surface is rejected.

### Page versions

Version labels remain metadata-only unless `corpus.versions` is explicitly configured.
Opt in with `corpus: { versions: { current: 'v2', order: ['v1'] } }`: `current` is required,
unlabelled pages belong to it, and `order` lists unique safe version labels.

The additional opt-in configuration contracts are `markdown.cacheControl` (an HTTP header
value, omitted to inherit), `corpus.rag` (`enabled: false`, `maxTokens: 512`, `publish: false`),
and `analytics` (`enabled: false`, `scope: 'agents'`, `sampleRate: 1`, `strict: false`).
Analytics adapters use a `type` of `console`, `jsonl`, `webhook`, `opentelemetry`, or `module`.
IP, query and referrer privacy settings accept only `'omit'`. Delivery headers use runtime
environment references such as `{ Authorization: { env: 'AEO_TOKEN', prefix: 'Bearer ' } }`,
never build-time secret values. Invalid booleans, enum values and new options report their
configuration path through `AeoConfigError`.

A page may carry a documentation version label: `version: 'v2'` on a catalog descriptor, on
`defineAeoPage`, or as `data.version` on a content entry. A label is one path segment of letters,
digits, `.`, `_` or `-` (at most 64 characters); anything else is ignored, and a catalog reports
`catalog-invalid-version`. The label appears on `AeoPageRecord`, on plugin page records, and on the
page's corpus manifest entry. Without `corpus.versions`, labels remain metadata-only and change
no generated artifact; an unversioned site keeps its existing bytes.

With version partitioning enabled, current-version corpus paths stay unchanged. Archives insert
one version segment beneath the existing base and locale topology:

| Family | Current | Archived `v1` |
| --- | --- | --- |
| Locale index | `/docs/fr/llms.txt` | `/docs/fr/v1/llms.txt` |
| Locale full corpus | `/docs/fr/llms-full.txt` | `/docs/fr/v1/llms-full.txt` |
| Locale chunk | `/docs/fr/llms/guide-0001.txt` | `/docs/fr/v1/llms/guide-0001.txt` |
| Compatibility alias (`both`) | `/docs/llms-fr.txt` | `/docs/v1/llms-fr.txt` |

A global or single-locale root family uses `/docs/v1/llms.txt` for the archive. Static gzip
siblings append `.gz` to these same paths. This partitions corpus artifacts, not project routes
or companion URLs. Locale topology is selected from the complete inventory, not independently
per version. Configured `order` sorts observed archives; other observed versions follow in
code-unit order. A configured archive with no inventory does not invent pages.

`/llms/manifest.json` joins all versions with `versions`, scoped locale/artifact records, and page
`versionAlternates`. Each observed archive also has `/v1/llms/manifest.json`, restricted to its
own records. Both include only artifacts that win ownership arbitration. An incomplete live
inventory still fails closed, and runtime manifests omit static gzip siblings.

Cross-version page matching removes only the configured base, configured locale prefix and
matching version prefix, each at most once. It matches within a locale, never between languages.
When routes have different names, supply `versionGroup` on `defineAeoPage`, a catalog descriptor,
or content-entry data:

```js
defineAeoPage({ source: entry, version: 'v1', versionGroup: 'installation' });
```

Generated alternatives use `{ kind: 'version', version: 'v1', url: 'https://example.com/v1/install/' }`.
Existing `{ language: 'fr', url: '...' }` hreflang alternatives are unchanged and never treated as
version links. Version metadata crosses immutable plugin page boundaries; build hooks and live
corpus hooks see reciprocal alternatives after collection. Ambiguous logical identities and
conflicting declared version alternatives are errors, not guessed links. Audits check reciprocity
and locale/version identity among known records. Authored canonicals and graph identities remain
authoritative.

A catalog that cannot resolve, import, evaluate, or run `listPages()` warns and
contributes nothing rather than failing the build or server startup. Catalogs run in
configured order in both builds and server bundles; the first descriptor wins when
two catalogs name the same normalized path. `context` contains the command, site URL,
base path, and trailing-slash policy.

A request-time server lists each catalog once per process. Give a catalog a `revalidate` window to
list it again once that many seconds have passed since its last listing, so a CMS catalog picks up
published entries without a restart: `{ module: './src/aeo-catalog.js', revalidate: 30 }`. `0` lists
on every use of the inventory, and `false` (or omitting it) keeps the first listing. If a revalidating
catalog's first listing fails, it is retried on its next use instead of staying empty; if a later
refresh fails, the last listing stays in place and the refresh is retried after another window.
A refresh never holds up a request: the last inventory is served until the fresh one is ready.
Development always lists afresh, and a build lists once.

Catalog entrypoints must be JavaScript that Node's native module loader can execute:
`.js`, `.mjs`, or `.cjs`. This keeps build preflight identical on every supported Node
version. Catalog logic may be authored in TypeScript, but it must be compiled to a
JavaScript entrypoint before Astro loads the integration. Source `.ts`, `.tsx`, `.mts`,
`.cts`, `.jsx`, and `.astro` catalog entrypoints warn and contribute nothing. Node's
built-in TypeScript support is not a portable substitute: it is unavailable on Node 20,
handles only erasable syntax by default, and ignores `tsconfig.json` behavior. See the
[Node TypeScript documentation](https://nodejs.org/api/typescript.html).

Request-time middleware owns `llms.txt` and `llms-full.txt` when at least one project page
route renders on demand, because those pages are outside the build's reach. When every page
route is prerendered the build emits both files even if an adapter is installed, and they
contain every `getStaticPaths()` result.

In that case the middleware declines those paths, along with the schema corpus, rather than
answering with a second and shorter list: a request-time render cannot expand
`getStaticPaths()`. Every supported adapter serves static assets before the application, so
the emitted file answers. A deployment that reaches the application first, such as
`@astrojs/node` in middleware mode mounted ahead of its own static handler, receives `404`
instead. Serve your static output before the Astro handler.

Once middleware owns them, both files render each known route through the
application so page markers behave normally. Each route is rendered serially through
Astro's in-process rewrite pipeline: no network destination is derived from the Host
header, the trusted rewrite capability exists only in process, and caller credentials
are not copied into corpus renders. The one exception is the development rewrite
fallback described under "Dynamic routes and catalogs", which re-requests a single page
from the development server's own bound address after an in-process rewrite has failed,
and which is never present in a production or adapter bundle. `corpus.runtime.maxPages` defaults to 50. A larger
corpus returns `503` with `Cache-Control: no-store`, without partial output. Raise the
limit or select `'unlimited'` only when the deployment can safely absorb that work.
Temporary source failures also return a sanitized, non-cacheable `503`, never a successful
shorter text or schema corpus. This includes rendering, transport and body-read failures,
server errors, rate limits, and partial or unusably encoded HTML. GET and HEAD share the
failure status. Anonymous authorization denials, redirects, missing routes, non-HTML routes
and explicit page opt-outs remain valid exclusions; plugin and semantic errors retain `500`.
Astro 5 and Astro 6.0-6.2 receive `503` for request-time corpora because those
versions do not expose a disposable request state. Their closure-held client address,
cookies, and session cannot be replaced securely for an anonymous corpus render. The
response reports an unrecognized request state rather than an Astro version, because the
middleware can only observe the shape it was handed.
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

Negotiated responses inherit the page's cache policy unless `markdown.cacheControl`
explicitly overrides it. The override also applies to generated direct companions and
known static companions served through the edge helpers; application HTML, redirects and
unlisted assets keep their own policy. Omission preserves inherited behavior. Vercel's
helper performs an anonymous, bounded companion HEAD before a rewrite or negotiation
redirect and falls back to HTML if the asset is missing or unavailable. These helpers
are tested locally, not as deployed-provider verification.

Negotiated responses merge `Vary: Accept`, use a
full SHA-256 ETag, and support `HEAD` and `If-None-Match`. A `304` avoids response
bytes but currently still calculates the Markdown representation. A source `304` is
re-evaluated with a sanitized GET only when Markdown is strictly preferred; otherwise
it passes through unchanged. Redirects, API responses, negotiated error pages, and
`204`/`205` responses retain the application's original behavior.
Astro 7.3's `memoryCache()` skips caching a response that carries `Vary: Cookie` or
`Vary: *`. Negotiated responses vary on `Accept`, so they stay cacheable; a drop in
hit rate comes from cookie-varying responses your own site emits, not from
content negotiation.
An explicit `.md` request may convert an HTML error body while preserving its status.
Encoded and partial (`206`) HTML responses are not transformed.

**This applies to on-demand routes only.** Astro does not expose request headers to
a prerendered route, deliberately: those pages become static files, so honouring a
request header would work in `astro dev` and then silently stop working once
deployed. A project with no adapter prerenders everything and cannot negotiate
anywhere, and Astro-AEO warns if you configure it there. The `.md` companions are
unaffected and work on any hosting. A fully static site can still negotiate in its host's
edge layer: see [Static edge negotiation](#static-edge-negotiation).

### Extraction

`markdown.extraction.selectors` decides which part of a rendered page becomes
Markdown. Selectors are tried in order and the first one with any match wins, so the
default prefers a semantic `<article>` and falls back to `<main>`. If a page has
several top-level matches they are all converted, in document order; a match nested
inside another match is skipped so its content is not emitted twice. With no match,
extraction falls back to `<body>`.

Matches that repeat as items of one list are a listing, not the page: a grid of
`<article>` cards, or a `<ul>` whose `<li>` items each hold one. They are set aside, so a
blog index or a pricing page converts from `<main>` with its heading and intro, and a
post keeps only its own `<article>` when related-post cards follow it. A card still
counts as an item inside a wrapper that holds nothing else, such as its own grid cell.
If only list items match every selector, extraction falls back to `<body>`.

`script`, `style`, `noscript`, `iframe`, and `head` are always dropped, in addition to
`removeSelectors`. `keepSelectors` emits matching elements as minimized raw HTML instead of
converting them, for a widget whose markup carries meaning. It removes presentation
attributes and bare `div`/`span` wrappers, including on a selected root. Removal wins over
keeping, and the always-dropped tags can never be reintroduced this way.

Buttons (except disclosure toggles with `aria-expanded` or `aria-controls`), `svg`,
`template`, `[hidden]`, and `[aria-hidden="true"]` elements are dropped as interface
chrome, unless they wrap an image with alt text. One exception keeps meaningful glyphs: an inline
`aria-hidden="true"` element with no child elements, outside links, buttons, `summary`, `label`,
`pre`, and `code`, is unwrapped to its text when that text is either a separator of at most four
characters (arrows, middle dots and bullets, bars and slashes, dashes, guillemets and angle
quotes, colons) with text on both sides in the same inline run, or a box-drawing tree prefix
(such as `├──`) with text after it. A separator is padded with spaces; a tree prefix is kept
verbatim; an arrow directly after a link stays dropped. Emoji, stars, and check marks are never
kept, since they usually repeat visually hidden text.

Figures keep their shown images followed by the caption in emphasis. Alternate states of one
subject (images hidden from assistive technology, `[hidden]`, Starlight's `light:sl-hidden`, or a
`hidden` image shown only in dark mode) are dropped while a shown image remains, so both images of
a before/after comparison survive and adjacent labels are separated by a space. Code blocks become
fences whose language comes from a `language-*` or `lang-*` class, a `data-language` attribute on
the `pre` or `code`, or a filename at the start of a figure caption holding one code block; emit
`data-language` if your highlighter puts the language anywhere else. Image-free charts retain readable text or their accessible label.
Definition lists become a
bold term followed by its description, and tables whose cells are single-span inline
content become GFM pipe tables. `time`, `address`, and `cite` convert to their text.
Tables with `colspan`, `rowspan`, or block content in a cell, and `audio` and `video`,
stay HTML because Markdown cannot express them; that HTML keeps only meaningful
attributes (`href`, `src`, `alt`, `title`, `scope`, `colspan`, `rowspan`, `headers`,
`datetime`, `lang`, `aria-label`, `poster`, `type`) and drops bare `div` and `span`
wrappers. Empty links and images inherit accessible names from `alt`, `aria-label`,
`aria-labelledby`, then `title`.

`astro-aeo audit` reports `markdown-html-residue` for layout markup or presentation
attributes. It separately reports `markdown-raw-html` when at least three non-code
Markdown blocks contain HTML and either the companion contains 30 or more HTML tags,
or tag markup exceeds 25% of the non-code Markdown. A single necessary complex table
does not trigger the volume warning.

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

Rendered ARIA tabs become labelled Markdown sections, including inactive panels and
Starlight tabs whose source conversion falls back to HTML. Panels retain their document
order. Unrelated hidden interface content and explicitly removed elements remain excluded.

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

On a multilingual site, path rules are evaluated against the locale-relative pathname: a page grouped under locale `de` and served at `/de/blog/post` is matched as `/blog/post`, so one rule such as `/blog/**` applies inside every locale. Write rules without the locale prefix. A predicate still receives the page with its full `pathname`, plus `page.locale`: the locale the page is grouped under, or `null` or absent without i18n.

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

### Crawler identity snapshot

Crawler registry version 2 separates observable User-Agent claims from robots control tokens.
Default robots policy keeps its existing tokens and ordering. The observable registry adds
[Applebot](https://support.apple.com/en-us/119829) and Amazon's
[Amzn-SearchBot and Amzn-User](https://developer.amazon.com/amazonbot), checked against first-party
operator documentation on 2026-10-03. Google-Extended and Applebot-Extended are policy controls,
not observable crawler identities. A User-Agent token is a claim, not operator authentication.
Meta's existing entry retains its prior verification date because its first-party page could not
be retrieved during this review; no new Meta identity is inferred from third-party descriptions.

### Small corpora, chunks, manifests, and gzip

`corpus.small` builds a strict token-budgeted `llms-small.txt` from contiguous leading source
blocks. It uses stable round-robin allocation across locales, sections, and pages, counts wrappers
against the limit, and never summarizes or rewrites content. A page cut short by the budget is
reported as `small-corpus-truncated` with severity `info`, since that is the budget working; a page
whose first block does not fit (`small-corpus-first-block-omitted`) is a warning. `corpus.chunks`
splits full-corpus content at page, heading, paragraph, and fenced-code boundaries. Fences remain
indivisible and an oversized unit is emitted with a diagnostic rather than silently truncated.
Consecutive headings stay with their first content block. A complete heading section moves to
a fresh chunk when it fits there but not in the current chunk; trailing headings never form
an orphan chunk. Small-corpus allocation uses the same indivisible units.

The built-in `astro-aeo-approx@1` counter is deterministic and explicitly approximate. A custom
local tokenizer module must default-export API version 1 with stable `name`, `version`,
`approximate`, and `count()` fields. It is probed twice. Any load or count failure restarts the
whole plan with the built-in tokenizer so a manifest never mixes identities. The manifest records
`tokenizerFallback: { reason: "preflight" | "count" }` when this happens, without module paths,
exception messages, or options. Successful and unconfigured plans omit the field.

When enabled, `/llms/manifest.json` records locales, canonical artifacts, pages, and exact SHA-256
byte hashes of published companions. Pages without a `.md` companion (Markdown disabled, `no-dotmd`,
or `generateMarkdown: false`) keep a page record with `markdownUrl`, `tokenCount`, and `hash` set to
`null`. When a companion exists, `hash` and `tokenCount` match the emitted `.md` bytes after
`renderMarkdownDocument` (frontmatter, trailing newline, and last-modified footer included). Static
`corpus.compression.gzip` adds deterministic level-9 siblings for text corpus artifacts. Runtime
middleware serves every logical artifact except precompressed gzip and relies on provider transport
compression.

### Incremental processing cache

Build processing uses independent versioned extraction, page normalization, pure plugin
transformation, graph, tokenization, and artifact entries under `.astro/aeo-cache/processing-v1`.
Each stage keys its relevant content, configuration, producer, and declared extension versions.
HTTP cache policy does not invalidate extraction. Tokenization keys the tokenizer identity,
options, and normalized text; locale text and section chunks depend on their own participating
pages, while global corpora depend on the full participating inventory.

Only pure/versioned hook stages and non-inline pure/versioned renderers are reused. Undeclared
hooks, inline renderers, and function-dependent stages run again without disabling unrelated
caches. A declining unsafe renderer can still reuse unchanged rendered-HTML fallback conversion.
Thrown or malformed hook failures never become reusable successful plugin results. Parser and
converter dependency refreshes invalidate affected stages, not unrelated tokenization/artifacts.
Package upgrades and downgrades reset all entries. If you edit a git checkout or linked copy
without changing its package or declared extension version, clear `processing-v1` before building.
Git modification dates are merged after extraction. Incomplete inventories retain unseen cache
entries and withhold stale output deletion. Identical output bytes retain their mtimes; missing
owned artifacts are restored through the ordinary ownership transaction.

An exclusive same-host process lock protects reusable state. A locked or invalid state makes the
build run cold and read-only, with no stale deletion authority: stale files are kept, recorded for a
later build to remove, and reported once, and IndexNow state does not advance. A lock ends with the
build that holds it (a lock left by a dead process on the same host is reclaimed); an invalid state
stays until `.astro/aeo-cache/processing-v1` is deleted. Project routes and `public/` files still
win. A stale file is deleted only when the prior ledger names Astro-AEO, the path is confined, the
file is regular and not a symlink, and its bytes still match the prior emitted hash. To clear the
cache by hand, delete only `.astro/aeo-cache/processing-v1`: deleting all of `.astro/aeo-cache` also
discards the artifact ownership and IndexNow ledgers. Set `cache.enabled: false` to stop reuse.

Builds also write private `pages-v1.json` and `trace-v1.json` under `.astro/aeo-cache`, both mode
`0600`. Snapshots contain component hashes and ownership etags, not page content. Trace records
cache outcomes/reasons, skips, plugin actions, source strategy/renderer identity, graph provenance
counts, HTML transform names, and generated/restored/removed/preserved artifact decisions.
Both carry the same content-derived `buildDigest`; timestamps, timings, and warm/cold outcomes
are excluded from that identity. Evidence omits source bodies, source locations, absolute paths,
credential-bearing URLs, and diagnostic messages. These files are not public artifacts and must
not be copied into a deployed output directory. The exported `AeoPageSnapshotV1` and
`AeoProcessingTraceV1` types describe their versioned contracts.

### The universal robots.txt group

`discovery.robots.universalAllow` (default `true`) makes `robots.txt` lead with a `User-agent: *` / `Allow: /` group, so unlisted crawlers see an explicit open policy even when you also name specific bots in `allow`/`disallow`. It is suppressed automatically if you already declare a `User-agent: *` group yourself (via `allow`, `disallow`, or `extraLines`), so there is no duplicate group. Set it to `false` for a named-bots-only policy.

The `custom` policy preserves this renderer. Presets use a frozen, first-party-documented crawler
registry: `open`, `search-open-training-closed`, `retrieval-only`, and `closed`. The registry
covers OpenAI, Anthropic, Perplexity, Google, Microsoft, Apple (`Applebot-Extended`), Meta
(`Meta-ExternalAgent`), Amazon (`Amazonbot`) and Common Crawl (`CCBot`) tokens. Per-token
`allow`/`disallow` overrides are case-insensitive and cannot overlap. Content Signals are emitted
only when all three booleans are supplied, and each `Content-Signal` line is placed inside every
applicable `User-agent` group (Cloudflare treats it as a group directive). When
`i18n.indexes` is `locale`, robots does not advertise a root `# llms.txt:` hint because no root
`/llms.txt` is emitted or served. Robots policies and experimental Content Signals state
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

A removal is inferred from a URL's absence, so it is only trustworthy when the build saw every
page. When a build cannot, because a catalog entry was rejected, a plugin failed, or a page's built
HTML could not be read, removals are withheld for that build and a warning names the cause. New and
changed pages are queued normally, so a broken catalog never stops you announcing new content.
Removals resume on the next build with a complete inventory.

Submission verifies a same-origin HTTPS key file without redirects, pins public DNS addresses,
enforces `keyLocation` directory scope before posting (a non-root key authorizes only URLs beneath
that directory), batches at 10,000 URLs, and retries network errors, `429`, and `5xx` responses
three total times. Successful batches update acknowledgment state atomically; failed work remains
pending. Remote failures warn with exit 0 unless `strict` is enabled. `IndexNowInvocationError`
(malformed invocation, origins, credentials, key responses, lock failures, or scope violations)
always exits 2. Keys, secret-derived paths, and POST bodies are never logged or persisted.

### Profile email

`site.profile.origins` maps normalized HTTP(S) origins to overrides of `name`, `description`,
`website`, `email`, `logo`, `sameAs`, and `entityType`. Other fields inherit the shared profile;
`enabled` remains shared. For example, `{ 'https://fr.example.com': { name: 'Exemple' } }`
changes the French host's profile without changing another host. Credentials, paths, queries,
fragments, duplicate normalized origins, and unknown override keys are rejected. Build and runtime
use the same renderer, and an authored `website` still takes precedence over the active origin.

`site.profile.email` is routed into the schema.org profile by value shape: an `http(s)` URL becomes a `contactPoint` (`{ '@type': 'ContactPoint', url }`), a value containing `@` becomes `email`, and anything else becomes `telephone`. The old `domainProfile.contact` key is a deprecated alias; it still works but emits a deprecation warning.

### Serving .md companions

On a project with an adapter, `.md` requests are served by Astro-AEO's own middleware,
which sets the content type itself and re-enters your routing, so your own middleware
and its authentication apply to a `.md` request exactly as they do to the HTML.

Configuring an adapter authorizes Astro-AEO to inject on-demand fallback routes for catch-all
`.md` requests and every enabled runtime artifact. This can turn an otherwise static adapter
build into server or hybrid output. That promotion does not move the corpus: `llms.txt` and
`llms-full.txt` are still emitted at build time unless one of your own page routes renders on
demand. The endpoints return `404` when pre-middleware declines and
exist so provider routing reaches that middleware before a custom-404 fallback. Literal project
`.md` routes retain ownership unless their exact served pathname is listed in
`artifacts.replace`.

`astro dev` receives the same routes, adapter or not, when the project routes its own `/404` to a
redirect (`redirects: { '/404/': '/error/' }`). Astro resolves a redirect route in its routing
layer, before middleware runs, so such a project would otherwise answer `llms.txt`, `robots.txt`,
`/.well-known/domain-profile.json`, and every `.md` companion with that redirect instead of letting
Astro-AEO respond. Two consequences apply to those development servers only: an unclaimed `.md`
path returns a bodyless `404` rather than reaching the 404 route, and companions of prerendered
pages are rendered through a loopback request to the development server, which the terminal log
shows. Any other `/404`, including none at all, dispatches middleware on its own, so nothing is
injected and nothing changes. Build output is never affected: a build without an adapter still
injects nothing.

One combination stays out of reach on Astro 6 and older: a project that sets
`trailingSlash: 'always'` and redirects its own `/404`. Those Astro versions derive a dynamic
route's trailing-slash pattern from the project configuration alone, so the injected `.md`
catch-all matches `/about.md/` but not `/about.md`, and the redirect answers the slashless
spelling. The exact artifact paths (`llms.txt`, `llms-full.txt`, `robots.txt`,
`/.well-known/domain-profile.json`, `/llms/manifest.json`) are unaffected on every supported
Astro, because a static endpoint path carrying a file extension is already exempt. Astro 7 extends
that exemption to dynamic endpoint patterns, so companions work there too.

Release gates build Node, Cloudflare, Deno, Vercel, and Netlify fixtures. The full request
contract runs locally for Node, Cloudflare in workerd, and Deno. The emitted Vercel and Netlify
handlers run in process against a smaller set: `.md` `GET`, `HEAD` and `304`, the runtime
artifacts, `robots.txt` passthrough, and the Markdown `404` for an unknown `.md`. Separate
assertions verify that Vercel routes runtime artifacts to `_render` before its status-404 fallback
and that Netlify does not short-circuit `.md` through bundled custom-404 content.

The stock `@astrojs/cloudflare()` adapter needs no extra wiring. If you replace its worker
entrypoint with a hand-written `astro/fetch` handler, wrap the app response in
`finalize(state, response)` from `@astrojs/cloudflare/fetch` (Astro 7.3 and newer). Without it
cookies set during the request, including the ones Astro-AEO merges when it rewrites a direct
`.md` request into your route, may never reach the client. The `@astrojs/cloudflare/hono`
middleware applies those headers already.

Origin-scoped runtime artifacts (`llms.txt`, `llms-full.txt`, the corpus paths, and
`/.well-known/domain-profile.json`) are served only when the request origin matches the configured
`site` or one of the configured i18n domains. `astro dev` and `astro preview` additionally accept
their loopback origin; a deployed server does not, so a spoofed `Host: localhost` cannot claim the
configured site. On Astro 5 and Astro 6 the Node adapter rewrites the request host to `localhost`
unless the domain is allowed, so those projects need Astro's own host trust for the artifacts to be
reachable:

```js
export default defineConfig({
  site: 'https://example.com',
  security: { allowedDomains: [{ hostname: 'example.com' }] },
});
```

Astro 7 keeps the request `Host` header without that setting.

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
  - path: /**/*.md
    name: Content-Type
    value: text/markdown; charset=utf-8
```

Render matches root and nested files separately. Both rules are needed, as described
in its [header matching documentation](https://render.com/docs/static-site-headers).

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
`BlogPosting`, `TechArticle`, `BreadcrumbList`, `ImageObject`, `VideoObject`, `Product`,
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
`503` with `Cache-Control: no-store` for full request-time corpora, reported as an unrecognized
request state. Astro 6.3 or newer is required for disposable per-page request state.

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
`page:transform`, `page:metadata`, `graph:build`, `rag:record`, `artifact:generate`, `artifact:validate`, and
`build:complete`. Inputs are immutable; a hook keeps, replaces, or isolates its current scope.
Runtime modules use literal entrypoints and strict JSON options. Omitting runtime `options` leaves
`api.options` undefined, while an explicit JSON `null` remains `null`. Graph replacements are
reconciled with unchanged authored JSON-LD before Astro-AEO regenerates its one managed script, so
build and runtime corpora use the same final graph. Artifact claims are exact
app-relative pathnames, and runtime page access never exposes raw requests, cookies, credentials,
or arbitrary rendering. The built-in semantic pipeline uses this same dispatcher.

Register a hook with `{ recoverable: true }` to warn and retain its last valid input when
that hook throws. Later hooks continue. Malformed results or replacements, explicit
isolation, setup errors and module failures still fail closed. Build and runtime must
register the same recovery setting. Only `rag:record` accepts `{ action: 'drop' }`, which
drops that record without isolating the page. Artifact hooks receive an `ArtifactEnvelope`
(`Artifact` is its alias): `{ claim, representation }`, with a null representation before
generation. `ArtifactClaim` and `ArtifactRepresentation` describe those actual boundaries.

Hooks on `page:discovered`, `page:extract`, `page:transform`, `page:metadata`, and `graph:build`
may declare themselves pure:

```js
api.on('page:metadata', hook, { cache: { pure: true, version: '2' } });
```

The declaration is recorded in the build's hook manifest and checked when the runtime module
loads. A runtime module that registers different hooks or different declarations than the build
fails to load, and its stages isolate. Bump `version` whenever the hook's output changes for the
same input. The declaration does not currently let a build skip hook execution: every hook runs
on every build.

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
| `FaqJsonLd` | `items: { question, answer }[]`, `id?` | FAQPage. `id` (such as `#faq`) sets a stable `@id`, resolved against the page URL, so the schema map can list it. An `id` that does not parse or names the page itself is omitted |
| `HowToJsonLd` | `name`, `steps: { name, text, url?, image? }[]`, `description?`, `totalTime?` | HowTo |
| `BreadcrumbJsonLd` | `items?`, `labels?`, `includeHome?` | Auto-derives the trail from the URL when `items` is omitted |
| `OrganizationJsonLd` | `name`, `url?`, `logo?`, `sameAs?`, `contactEmail?` | `url` defaults to `site`. Place once, e.g. the homepage |
| `SpeakableJsonLd` | `cssSelector?` (default `['main']`), `url?` | Drop-in with no props |
| `ArticleJsonLd` | `headline`, `type?`, `datePublished?`, `dateModified?`, `author?`, `publisher?`, `image?`, `keywords?`, `inLanguage?`, `description?`, `url?` | `Article` by default; also `BlogPosting` or `TechArticle`. Person/Organization author or author array, string image or image array. Dates pass through unchanged |
| `ProductJsonLd` | `entity` | Fixed `Product`; Product snippet checks, not merchant-listing requirements |
| `SoftwareApplicationJsonLd` | `entity` | Fixed `SoftwareApplication` |
| `ReviewJsonLd` | `entity` | Fixed `Review`; caller supplies the reviewed item and rating |
| `ItemListJsonLd` | `entity` | Fixed `ItemList`; no speculative Google profile |
| `DatasetJsonLd` | `entity` | Fixed `Dataset` |
| `ProfilePageJsonLd` | `entity` | Fixed `ProfilePage` |
| `ServiceJsonLd` | `entity` | Fixed `Service`; no speculative Google profile |
| `LocalBusinessJsonLd` | `entity` | Fixed `LocalBusiness`; caller supplies business details |

Each compatibility component renders a single, XSS-safe `<script type="application/ld+json">`.
They use the graph builders internally while preserving their established props and serialized
output. New semantic pages should prefer `AeoHead` and `astro-aeo/schema`.

The eight entity-bag components supply their fixed `@type` and Schema.org context. Their required
`entity` bag uses the Schema.org vocabulary types, omitting these reserved fields. They clone inputs,
escape script-sensitive characters, and invent no IDs, prices, offers, ratings, or business details.

```astro
---
import { ProductJsonLd, ArticleJsonLd } from 'astro-aeo/components';
---
<ProductJsonLd entity={{
  name: 'Published product',
  offers: { '@type': 'Offer', price: 25, priceCurrency: 'EUR' },
}} eligibility="google" />
<ArticleJsonLd headline="Publishing guide" type="BlogPosting"
  author={[{ name: 'Ada' }, { '@type': 'Organization', name: 'Editorial team' }]}
  publisher={{ '@type': 'Organization', name: 'Publisher' }}
  image={['https://example.com/cover.jpg']} keywords={['publishing', 'schema']}
  inLanguage="en" />
```

All schema components accept `eligibility="schema" | "google"`, defaulting to `schema`.
Despite its name, this prop only selects field checks: it never certifies eligibility, changes
JSON-LD, throws for a Google finding, or suppresses output. A component can resolve references only
within its own entity; use the audit to resolve references across the page's final scripts.

### Optional publishing advice

```bash
astro-aeo audit dist --heuristics
astro-aeo audit https://example.com/ --heuristics
astro-aeo audit dist --schema-target google --fail-on warning
```

`--heuristics` adds deterministic English/German and language-neutral editorial advice at `info`
severity. Advice is score-neutral and cannot fail CI. The article review reminder compares dates
with the day the audit runs, so the same content can gain it on a later day. `--schema-target schema`
(the default) keeps existing graph checks; `google` adds documented field checks on final rendered
JSON-LD. Required Google fields produce warnings with the existing readiness deductions and
`--fail-on` behavior; recommendations remain informational. Both flags work for build directories
and live URLs, with all report formats. Neither flag changes the integration's on-build audit or
`validate`.

Schema.org validity and Google support are distinct. `FAQPage` and `TechArticle` output remains
available, but neither receives a current Google profile here. Explicit `eligibility="google"`
requests explain this at `info` severity; site-wide Google checks skip unsupported types.
`Article` and `BlogPosting` receive documented recommendations, not universal required fields.
See [content optimization](docs/CONTENT_OPTIMIZATION.md) for examples and false positives, and
[Google profile scope](docs/GOOGLE_SCHEMA_PROFILES.md) for documentation references and limitations.

## Doctor and fix

```bash
npx astro-aeo doctor                       # what this project is set up to deploy
npx astro-aeo doctor --url https://example.com/   # and what the deployment really does
npx astro-aeo doctor --print               # read-only evidence-based manual advice
npx astro-aeo fix                          # dry run: shows the change
npx astro-aeo fix --write                  # applies it, after a backup
```

Static hosts often serve `.md` files as `text/plain` or as a download. `fix` makes the host serve them as
`text/markdown; charset=utf-8` by editing exactly one file:

| Provider | File | Edit |
|---|---|---|
| Cloudflare Pages, Netlify | `public/_headers` | one block between `# astro-aeo:start markdown-mime` and `# astro-aeo:end markdown-mime`; every byte outside it, and CRLF line endings, are kept |
| Vercel | `vercel.json` | one `headers` rule; unknown fields, key order and indentation are kept |
| Render | `render.yaml` | root (`/*.md`) and nested (`/**/*.md`) headers on one static site service; comments, anchors and key order are kept |

It is a dry run unless you pass `--write`. Before writing, the original is copied with its file mode to
`.astro/aeo-backups/<UTC timestamp>/`. A second `--write` finds nothing to do and makes no backup. `fix`
refuses, without writing anything, when it finds several providers (choose one with `--provider`),
several Render static services (`--service`), a malformed document or markers, a competing rule for
`.md` paths, a symbolic link (including in the project directory), or a path outside the project. For nginx, Apache, Node, Cloudflare Workers
and Deno it prints a snippet and edits nothing: `astro-aeo fix --provider nginx`.

`doctor` reads the facts the last build recorded and the same provider files, and reports each check as:

| Status | Meaning |
|---|---|
| `configured` | verified against the deployment (only `--url` can say this) |
| `unverified` | the local files look right, which proves nothing about what is deployed |
| `missing` | nothing provides it; the hint says what to run |
| `conflicting` | something contradicts it, locally or in the deployment |

`--url <page>` probes one deployed page anonymously with a fixed number of requests: the companion's
content type, every case of the Accept contract the middleware and edge handlers are tested against,
`Vary: Accept`, `HEAD`, and `If-None-Match`. What the deployment does replaces what the local files
suggest. Exit codes: `0` when nothing is missing or conflicting, `1` otherwise, `2` for a bad invocation
or an unreachable URL. `--json` prints the checks.

Local Node, Deno, nginx and Apache files provide evidence of intent, not verified serving
behavior. Doctor also compares the selected output, deployment ownership digest and emitted
artifact etags. Mismatched evidence withholds artifact conclusions. Declared overlapping packages
and quoted config references are advisory, with explicit confidence; consumer configuration is
never executed. `--print` adds manual advice, or an `advice` array with `--json`, without writing
configuration. See [deployment evidence and advice](docs/DOCTOR.md) for scope and limitations.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
steps:
  - uses: actions/checkout@v4
  - run: npm ci && npm run build
  - uses: ZAAI-com/Astro-AEO@1.6.0
    with:
      target: dist            # or a deployed URL
      fail-on: error          # error, warning or none
```

The action runs the `astro-aeo` your project installed, writes a SARIF report, uploads it to GitHub code
scanning, adds a Markdown summary to the job, and only then reports the audit's exit status, so findings
are uploaded even when they fail the job. Set `upload-sarif: 'false'` where the workflow lacks
`security-events: write`, such as a pull request from a fork. Other inputs: `working-directory`,
`sarif-file`, and `args` for extra `audit` flags.

## Recipes

[`recipes/`](recipes/) holds small, complete projects: marketing, blog, Starlight, SaaS, commerce,
local business, i18n, and SSR, plus six for EmDash: one per EmDash template (`emdash-blog`,
`emdash-marketing`, `emdash-portfolio`, `emdash-starter`), a site that mixes them (`emdash`), and
the same mix on Cloudflare (`emdash-cloudflare`). Each builds on its own and passes
`astro-aeo audit` with no errors; the EmDash recipes are also served and checked request by request.

## Static edge negotiation

A site with no adapter is only files, so Astro cannot negotiate for it. On Cloudflare, Netlify, and
Vercel the host's edge layer can. This is opt-in and has two halves: a plugin that makes the build emit a
manifest, and a small handler you deploy.

```js
// astro.config.mjs
import aeo from 'astro-aeo';
import { cloudflareEdge } from 'astro-aeo/edge/cloudflare'; // or netlifyEdge, vercelEdge

export default defineConfig({
  site: 'https://example.com',
  integrations: [aeo({ markdown: { negotiation: 'response' }, plugins: [cloudflareEdge()] })],
});
```

```js
// Cloudflare Pages: functions/_middleware.js
import { createCloudflareHandler } from 'astro-aeo/edge/cloudflare';
export const onRequest = createCloudflareHandler().onRequest;
// A Worker with a static assets binding instead: export default { fetch: createCloudflareHandler().fetch };
```

```js
// Netlify: netlify/edge-functions/aeo.js
import { createNetlifyHandler } from 'astro-aeo/edge/netlify';
export default createNetlifyHandler();
export const config = { path: '/*' };
```

```js
// Vercel: middleware.js (Routing Middleware). The platform helpers are yours to install.
import { next, rewrite } from '@vercel/functions';
import { createVercelHandler } from 'astro-aeo/edge/vercel';
export default createVercelHandler({ next, rewrite });
```

Pass `{ base: '/docs' }` to a handler when the site sets Astro's `base`.

The build writes `/.well-known/astro-aeo-edge-v1.json`: `{ version: 1, provider, mode, base, routes:
[{ html, markdown }] }`, sorted, listing only the companions the build really emitted. A companion that a
project route or a `public/` file displaced is never advertised. `mode` is your `markdown.negotiation`.

The handlers follow the Astro middleware's rules exactly, and one shared contract table tests both: `GET`
and `HEAD` only, exact manifest routes only (with or without a trailing slash), Markdown only when it
strictly outranks HTML, `303` with the query preserved in `'redirect'` mode, and `Vary: Accept` on every
listed route whichever representation is chosen. They fail closed to the unmodified HTML response when
the manifest is missing, malformed, or from a future version. On Cloudflare and Netlify the handler
serves the companion itself as `text/markdown; charset=utf-8` with the asset's `ETag` and cache policy,
`304` for a matching `If-None-Match`, and no body for `HEAD`, and it also falls back to the HTML when a
stale manifest lists a companion that is gone. Vercel middleware cannot read a response, so there the
handler rewrites to the companion and the platform serves it: for a companion that a stale manifest
lists but that is gone, the negotiated request gets the platform's `404`, not the HTML.

The plugin is rejected with an error when the project configures an adapter (the Astro middleware already
negotiates there), when a page renders on demand, or when `markdown.negotiation` is `'off'`. Without the
plugin nothing changes: no manifest is written and no output byte differs.

The Cloudflare handler is tested in real workerd and all three against the shared contract locally. None
of them has been verified on a deployed provider yet, so treat a first deployment as your own check:
`curl -H 'Accept: text/markdown' https://example.com/` should answer `text/markdown`.

## Starlight

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import starlightAeo from 'astro-aeo/starlight';

export default defineConfig({
  site: 'https://docs.example.com',
  integrations: [
    starlight({
      title: 'Docs',
      plugins: [starlightAeo({ aeo: { discovery: { robots: { enabled: true } } } })],
    }),
  ],
});
```

`starlightAeo()` is a Starlight plugin (Starlight 0.32 or newer). It registers the Astro-AEO integration
itself, so do not also add `aeo()` to `integrations`: that is rejected with an error. Pass the
integration's options as `aeo`.

Each docs page publishes its authored Markdown, not a conversion of the rendered HTML:

- The page title becomes the top-level heading, and `:::note`, `:::tip`, `:::caution` and `:::danger`
  asides become labeled blockquotes (`> **Caution: Back up first**`).
- In MDX, `<Tabs>` and `<TabItem label="...">` become labeled sections, `<Aside>`, `<Card>` and
  `<LinkCard>` are converted, and `import` lines are dropped. Code fences are never touched.
- A page that renders a value (an expression, an `export`, any other component, or an attribute computed
  at run time) is not guessed at. It falls back to extracting the rendered `.sl-markdown-content` region
  and records the `authored-source-fallback` diagnostic.
- An explicit `<AeoPage>` on a page always wins over what the plugin infers.

| Option | Default | Meaning |
|---|---|---|
| `aeo` | `{}` | Options for the Astro-AEO integration. |
| `links.pagination` | `true` | Append Starlight's previous and next page links to each companion. |
| `links.edit` | `false` | Append the "edit this page" URL when Starlight resolved one. |
| `links.source` | unset | Append a repository source-view URL using an explicit `{ baseUrl }` ending in `/`. Independent of edit links. |
| `links.versions` | `false` | Append known same-locale version links to companions and corpus text. |
| `versions` | unset | Explicit `{ current, archived }` version labels and served route prefixes. |
| `techArticle` | `true` | Add a minimal `TechArticle` entity from the page's own title, description, language and modified date. Nothing is inferred. |

Three integration defaults differ under Starlight, and each yields to what you set in `aeo`:
`discovery.sitemap.mode` is `'external'` because Starlight registers `@astrojs/sitemap` itself,
`markdown.extraction.selectors` starts with `.sl-markdown-content`, and `/404` is added to
`pages.exclude`.

The page source travels through the same private marker as `<AeoPage>`: it is emitted only while
Astro-AEO collects a page, never on a visitor's request, and it is removed before anything is written or
served.

Versioned documentation uses an explicit configuration, including when another plugin such as
`starlight-versions` owns the routes:

```js
starlightAeo({
  versions: { current: 'v2', archived: ['v1', { version: 'v0', prefix: 'release-0' }] },
  links: {
    source: { baseUrl: 'https://github.com/example/docs/blob/main/' },
    versions: true,
  },
  aeo: { corpus: { manifest: { enabled: true } } },
});
```

Each archive string uses the same version label and prefix. An object separates the safe
single-segment label from its served prefix. Prefixes match public `starlightRoute.id`, not raw
source-directory names: configure the actual served slug if the content loader normalized it.
Only configured prefixes are interpreted, before or after the public locale prefix. Current
pages keep their routes. The plugin populates `aeo.corpus.versions.current` and defaults archive
order to the configured list; a conflicting explicit current value is rejected. It does not
discover upstream versions, install a versioning plugin, or rewrite source/project routes.

The public route's `isFallback` and `entryMeta` facts identify untranslated pages. Such pages
remain available as HTML and Markdown companions but are excluded from the requested locale's
corpus with `starlight-fallback-locale-excluded`. This also applies when an authored `<AeoPage>`
supplies the source. Authored content and metadata still win; missing route-version facts are
filled from the inferred marker. Source links use relative public `entry.filePath` values and
never expose an absolute local path. Version footers are rendered from known reciprocal
inventory, not guessed URLs. On-demand projects still need an explicit complete catalog for
live corpus paths; a direct companion without known peers omits version links.

These facts use only Starlight's [public route-data API](https://starlight.astro.build/reference/route-data/).
Held source bodies are content-hashed privately, including MDX; raw MDX is never published.
Configured version prefixes can mirror the upstream plugin's
[version slugs](https://starlight-versions.vercel.app/configuration/#slug) without private imports.

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

`validate` and its JSON output are frozen. New checks are added to `audit`.

## Audit

```bash
npx astro-aeo audit                          # audits ./dist
npx astro-aeo audit dist --format sarif --output aeo.sarif
npx astro-aeo audit https://example.com/ --max-pages 200
```

`audit` runs everything `validate` checks and adds site-wide rules: broken internal links and missing
anchors, duplicate titles, descriptions and canonicals, Markdown companion quality, JSON-LD validity
through the schema graph validator, and hreflang targets and return links. When the project's
`.astro/aeo-cache` manifests sit beside the build directory, the build's own diagnostics and ownership
conflicts are reported too. Every rule ID is listed in [docs/rules.md](docs/rules.md); an ID is the same
string the build and `validate` already use as `code`.

Offline audits resolve absolute and protocol-relative internal links, including hreflang, when the
local origin is known from the generated `llms/manifest.json` or, as a fallback,
`.well-known/domain-profile.json`. An explicit `auditDist(distDir, { siteUrl })` option takes precedence for
internal callers. Without this metadata, relative links are still checked, but absolute URLs are
skipped: a canonical link alone does not establish the deployment's origin. External links are
never fetched by an offline audit.

Markdown quality checks use the generated companion paths (`/guide.md` for `/guide/index.html`).
An offline audit refuses a build directory reached through a symbolic link, including a linked parent.
Live audits report failed advertised companions and isolate response-body timeouts to the affected
request, so a broken linked page does not discard the rest of the report. Missing HTML language
attributes are checked both offline and live, except on noindex pages.

| Option | Meaning |
|---|---|
| `--format <name>` | `terminal` (default), `json`, `sarif`, `html`, `markdown`, `github`, or `junit`. All seven render the same report. |
| `--output <file>` | Write the report to a file (temporary file, then rename) and print nothing to standard output. |
| `--fail-on <level>` | `error` (default), `warning`, or `none`. A `junit` report fails exactly these findings' cases; the others pass with their message in `<system-out>`. |
| `--no-score` | Omit scores and per-finding deductions. |
| `--base <path>` | Base path of a build directory. |
| `--max-pages <n>` | URL only. Page cap, default `500`, or `unlimited`. |
| `--allow-origin <origin>` | URL only, repeatable. Another origin the crawl may follow. |
| `--timeout <ms>` | URL only. Per-request timeout, default `10000`. |
| `--concurrency <n>` | URL only. Parallel requests from `1` to `32`, default `8`. |

Exit codes: `0` pass, `1` findings at or above `--fail-on`, `2` bad invocation or a target that cannot
be reached. Scores never affect the exit code.

A URL target is crawled anonymously: no cookies, no authorization, and no request to any origin outside
the start origin and `--allow-origin`, including through redirects. Queries and fragments are stripped
from page identities, at most five redirects are followed, and a response over 5 MiB is skipped. Pages
are fetched level by level in sorted order, so a capped crawl audits the same pages every time. A page
the crawl did not reach is unknown, never "broken". The JSON report records the crawl scope.

The JSON format is `AuditReportV1` (exported from `astro-aeo`, with a JSON Schema at
`astro-aeo/audit-report.schema.json`). It has no timestamp and no absolute path, so two audits of the
same input are byte-identical.

Scores use the `astro-aeo-readiness-v1` rubric and are advisory. Each category starts at 100. An error
removes 15 points and a warning 5, one rule can remove at most 30 points from its category (errors
count first), and a category never goes below 0. The internationalization category is left out when the
site has one language or none. The overall score is the mean of the scored categories, rounded to two
decimals.

## How It Works

Astro-AEO hooks into Astro's standard integration lifecycle. Build and runtime processing share the
same staged discovery, extraction, normalization, metadata, graph, validation, and artifact logic.
On `astro build`, generated files and targeted HTML enrichments are buffered until validation and
ownership checks finish, then committed atomically. No separate package build step, external
service, or network self-fetch is required. Redirect stubs and non-HTML outputs are skipped.

In `astro dev`, a middleware serves `robots.txt`, `domain-profile.json`, and `.md` companions live, and renders the aggregate corpora on request. `pages.devDynamicDiscovery` defaults to `'startup'`, so prerendered dynamic routes are enumerated in development as well; see "Dynamic routes and catalogs" for what each mode does, when a restart is needed, and how overlapping dynamic route patterns are handled. On-demand, CMS-only, and other externally inventoried paths still need a `pages.catalogs` module, and the build output remains the source of truth. If your project redirects its own `/404`, those paths are matched by development-only injected routes so the redirect cannot intercept them; see "Serving .md companions".

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
