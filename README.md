# Astro-AEO

Answer Engine Optimization for Astro. One integration, zero config, ten features.

Astro-AEO makes your Astro site easy for AI search engines, assistants, and LLMs to discover, parse, and cite. It generates clean Markdown copies of every page, an `llms.txt` index, JSON-LD components, crawler policies, and domain identity metadata with no external services or client JavaScript.

It is the Astro sibling of [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).

## What is AEO

Answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews, and others) read your pages to answer questions and cite sources. They do better with clean, structured text than with a page of HTML, scripts, and styles. AEO is the practice of publishing machine-readable companions to your site so those systems can find and quote your content accurately.

A Markdown copy of a page is roughly 20 to 30 percent smaller in tokens than its HTML. An `llms.txt` index of your whole site is a fraction of the size of crawling every page. Smaller, cleaner inputs mean cheaper, more accurate answers that are more likely to cite you.

## Features

- **.md companion pages**: a clean Markdown copy of every page, preserving authored Markdown when available and otherwise extracting from rendered HTML.
- **llms.txt and llms-full.txt**: a site index and a full-content file following the [llmstxt.org](https://llmstxt.org/) spec.
- **Alternate link tags**: `<link rel="alternate" type="text/markdown">` injected into every page so crawlers can find the Markdown.
- **JSON-LD components**: `FaqJsonLd`, `HowToJsonLd`, `BreadcrumbJsonLd`, `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`.
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

Out of the box you get: a `.md` companion beside every page, `llms.txt` and `llms-full.txt` at the site root, an alternate link tag on every page, and a sitemap (via the auto-wired `@astrojs/sitemap`). Enable `discovery.robots`, `site.profile`, and `corpus.urlMap` when you want them.

## Configuration

All options are optional. Defaults are shown.

```js
aeo({
  site: {
    name: '',                        // llms.txt heading; falls back to profile, <title>, hostname
    description: '',

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
    catalogs: [],                    // modules listing data-generated routes
  },

  markdown: {                        // the .md companions
    enabled: true,
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

    urlMap: {
      enabled: false,
      outputFilepath: 'docs/Url-Map.md',
    },

    runtime: {
      maxPages: 50,                  // positive integer | 'unlimited'; refuses larger live corpora
    },
  },

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
      universalAllow: true,              // lead with "User-agent: * / Allow: /" (suppressed if '*' is named below)
      allow: [],                          // e.g. ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot']
      disallow: [],                       // e.g. ['GPTBot', 'ClaudeBot', 'Google-Extended']
      includeSitemap: undefined,          // omitted = auto-detect; true = force; false = omit
      sitemapPath: '/sitemap-index.xml',  // defaults to the @astrojs/sitemap output name (tracks filenameBase)
      includeLlmsTxt: true,
      extraLines: [],
    },
  },
});
```

### Migrating from 1.0

Every 1.0 key still works and produces the same output as its canonical replacement. Using one emits a
single deprecation warning per section; the 1.0 keys are removed in 2.0.

| 1.0 | 1.1 |
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
  its 1.1 replacement to **different** values is a build-stopping error naming both
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

`defineAeoPage` reads `body`, `data.title`, `data.description` and the dates off a
content-collection entry, or takes any of them directly. Every field is optional;
supplying none is the same as not using it at all, and extraction runs as usual.

The marker the component emits is internal. It is written only when Astro-AEO is
the one rendering the page (the build's prerender pass, or a request for the `.md`),
and it is removed from every page before anything is written or served, so it never
reaches a browser and never appears in a `.md` file.

Standalone `.md` page routes need no marker: Astro-AEO reads their source directly,
removes only leading YAML frontmatter, and embeds on-demand sources through a Vite
`?raw` registry in the server bundle. The release bundle-size gate measures this cost.

### Pages the build cannot see

Routes generated from data rather than from a file are invisible to Astro's page
list, so they are absent from `llms.txt` and get no `.md`. A catalog lists them:

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
base path, and trailing-slash policy. Astro-AEO does not crawl your site to discover
routes.

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
corpus render, including streams whose cancellation never settles.

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

### The universal robots.txt group

`discovery.robots.universalAllow` (default `true`) makes `robots.txt` lead with a `User-agent: *` / `Allow: /` group, so unlisted crawlers see an explicit open policy even when you also name specific bots in `allow`/`disallow`. It is suppressed automatically if you already declare a `User-agent: *` group yourself (via `allow`, `disallow`, or `extraLines`), so there is no duplicate group. Set it to `false` for a named-bots-only policy.

### Profile email

`site.profile.email` is routed into the schema.org profile by value shape: an `http(s)` URL becomes a `contactPoint` (`{ '@type': 'ContactPoint', url }`), a value containing `@` becomes `email`, and anything else becomes `telephone`. The old `domainProfile.contact` key is a deprecated alias; it still works but emits a deprecation warning.

### Serving .md companions

On a project with an adapter, `.md` requests are served by Astro-AEO's own middleware,
which sets the content type itself and re-enters your routing, so your own middleware
and its authentication apply to a `.md` request exactly as they do to the HTML.

Release gates build Node, Cloudflare, Deno, Vercel, and Netlify fixtures. Request
contracts run locally for Node, Cloudflare in workerd, and Deno. Vercel and Netlify
are build and provider-artifact checks only; no served behavior is claimed without
provider accounts.

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
| `ArticleJsonLd` | `headline`, `datePublished?`, `dateModified?`, `author?`, `image?`, `description?` | For posts and dated content |

Each component renders a single, XSS-safe `<script type="application/ld+json">`.

## Validator CLI

```bash
npx astro-aeo validate            # validates ./dist
npx astro-aeo validate dist --strict --json
```

Checks: `llms.txt` follows the spec and every referenced `.md` exists; `llms-full.txt` is present and separated; each page has exactly one Markdown alternate link; page titles, image alt attributes, robots meta tags, Open Graph previews, and Twitter card type pass basic crawler checks; `robots.txt` parses and its `Sitemap` is absolute; `domain-profile.json` is valid and has `@context`, `@type`, and `name`.

Exit codes: `0` pass, `1` validation errors (or warnings with `--strict`), `2` usage or IO error.

## How It Works

Astro-AEO hooks into Astro's standard integration lifecycle. On `astro build` it reads each rendered page once, converts the `<main>` region to Markdown with [Turndown](https://github.com/mixmark-io/turndown), and emits every output during `astro:build:done`. No separate build step, no external services, no post-processing scripts. Redirect stubs and non-HTML outputs are skipped automatically.

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
pnpm run test:adapters # build five adapters; request-test Node, workerd, and Deno
pnpm run release:check # schema, compatibility, tarball, adapters, and benchmarks
```

Tag publication adds `--require-clean`, checks that the numeric tag equals the package and changelog
version, and refuses a dirty checkout before the packed-tarball and provider gates run.

Tests are colocated next to the source they cover as `*.test.js`. The frozen
`fixtures/golden-1.0` output proves static byte compatibility with the actual 1.0
implementation, while `fixtures/config-compat` compares legacy and canonical option
spellings. The package is authored as plain ESM JavaScript with JSDoc types and a
hand-written `index.d.ts`, so it needs no build step and installs cleanly as a git dependency.

Working on this repo with an AI agent? See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the architecture, conventions, and test workflow. Notable changes are tracked in [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT (c) 2026 ZAAI. Built and maintained by [ZAAI](https://zaai.com). Sibling project: [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).
