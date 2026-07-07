# Astro-AEO

Answer Engine Optimization for Astro. One integration, zero config, nine features.

Astro-AEO makes your Astro site easy for AI search engines, assistants, and LLMs to discover, parse, and cite. It generates clean Markdown copies of every page, an `llms.txt` index, JSON-LD components, crawler policies, and domain identity metadata, all at build time with no external services and no runtime dependencies.

It is the Astro sibling of [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).

## What is AEO

Answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews, and others) read your pages to answer questions and cite sources. They do better with clean, structured text than with a page of HTML, scripts, and styles. AEO is the practice of publishing machine-readable companions to your site so those systems can find and quote your content accurately.

A Markdown copy of a page is roughly 20 to 30 percent smaller in tokens than its HTML. An `llms.txt` index of your whole site is a fraction of the size of crawling every page. Smaller, cleaner inputs mean cheaper, more accurate answers that are more likely to cite you.

## Features

- **.md companion pages**: a clean Markdown copy of every page, converted from the rendered HTML.
- **llms.txt and llms-full.txt**: a site index and a full-content file following the [llmstxt.org](https://llmstxt.org/) spec.
- **Alternate link tags**: `<link rel="alternate" type="text/markdown">` injected into every page so crawlers can find the Markdown.
- **JSON-LD components**: `FaqJsonLd`, `HowToJsonLd`, `BreadcrumbJsonLd`, `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`.
- **robots.txt**: allow search and retrieval bots, block training crawlers, with automatic `Sitemap:` and `llms.txt` hints.
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

Astro-AEO requires Astro 5 or newer. It ships as plain ESM with no build step, so it also works as a git dependency:

```jsonc
// package.json
"dependencies": {
  "astro-aeo": "github:ZAAI-com/Astro-AEO"
}
```

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

Out of the box you get: a `.md` companion beside every page, `llms.txt` and `llms-full.txt` at the site root, and an alternate link tag on every page. Enable `robotsTxt`, `domainProfile`, and `urlMap` when you want them.

## Configuration

All options are optional. Defaults are shown.

```js
aeo({
  include: ['**'],                 // path globs to include
  exclude: [],                     // path globs to exclude, e.g. ['/drafts/**']
  respectNoindex: true,            // skip pages with <meta name="robots" content="noindex">
  stripTitleSuffix: false,         // strip " | Your Brand" from titles: string | string[] | RegExp

  dotmd: {
    enabled: true,
    linkTag: 'auto',               // 'auto' | 'always' | 'never'
    includeLastModified: true,
    frontmatter: false,            // prepend YAML frontmatter to .md files
  },

  llmsTxt: {
    enabled: true,
    sections: [{ title: 'Home', match: '/' }],  // ordered, first match wins
    defaultSection: 'Pages',       // section for unmatched pages, or false to drop them
    includeDescriptions: true,
    showLastmod: false,
  },

  llmsFullTxt: {
    enabled: true,
    mode: 'all',                   // 'all' | 'index' | 'first-page-only'
  },

  robotsTxt: {
    enabled: false,
    allow: ['Googlebot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot'],
    disallow: ['GPTBot', 'ClaudeBot', 'Google-Extended'],
    includeSitemap: true,
    sitemapPath: '/sitemap-index.xml',
    includeLlmsTxt: true,
    extraLines: [],
  },

  domainProfile: {
    enabled: false,
    name: 'Your Site',
    description: 'What your site is about.',
    website: 'https://yoursite.com',   // defaults to the Astro `site`
    contact: 'hello@yoursite.com',
    logo: 'https://yoursite.com/logo.png',
    sameAs: ['https://github.com/you'],
    entityType: 'Organization',        // Organization | Person | Blog | ...
  },

  urlMap: {
    enabled: false,
    outputFilepath: 'docs/Url-Map.md',
  },
});
```

### Sections

`llmsTxt.sections` groups pages in `llms.txt`. Each rule has a `title` and a `match` that is a glob string, an array of globs, a RegExp, or a predicate `(page) => boolean`. Rules are evaluated in order, first match wins. Empty sections are dropped. Pages matching no rule fall into `defaultSection`.

```js
llmsTxt: {
  sections: [
    { title: 'Home', match: '/' },
    { title: 'Guides', match: '/guides/**' },
    { title: 'Blog', match: /^\/\d{4}\/[^/]+$/ },
  ],
  defaultSection: 'Pages',
}
```

Globs are segment-aware: `*` stays inside one path segment, `**` crosses segments and matches the base (`/blog/**` matches `/blog` and `/blog/post`). `/error` matches `/error` but not `/error-log`.

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

Checks: `llms.txt` follows the spec and every referenced `.md` exists; `llms-full.txt` is present and separated; each page has exactly one Markdown alternate link; `robots.txt` parses and its `Sitemap` is absolute; `domain-profile.json` is valid and has `@context`, `@type`, and `name`.

Exit codes: `0` pass, `1` validation errors (or warnings with `--strict`), `2` usage or IO error.

## How It Works

Astro-AEO hooks into Astro's standard integration lifecycle. On `astro build` it reads each rendered page once, converts the `<main>` region to Markdown with [Turndown](https://github.com/mixmark-io/turndown), and emits every output during `astro:build:done`. No separate build step, no external services, no post-processing scripts. Redirect stubs and non-HTML outputs are skipped automatically.

In `astro dev`, a middleware serves `robots.txt`, `domain-profile.json`, and `.md` companions live, and builds `llms.txt` from your static routes. Dev is best-effort: dynamic and content-collection routes are only fully enumerated by a build, so the dev `llms.txt` carries a note to that effect and the build output remains the source of truth.

Last-modified dates come from `<meta property="article:modified_time">` when present, otherwise from the git commit history of a static route's source file. Emit `article:modified_time` for precise dates on content-collection pages.

## Development

```bash
pnpm install
pnpm test            # colocated unit + CLI + build e2e tests (Vitest)
pnpm run test:dev    # dev-server e2e (spawns astro dev)
pnpm run typecheck   # tsc --noEmit against JSDoc types
pnpm run demo:dev    # run the demo site in fixtures/demo
pnpm run demo:build  # build the demo site
```

Tests are colocated next to the source they cover as `*.test.js`. The package is authored as plain ESM JavaScript with JSDoc types and a hand-written `index.d.ts`, so it needs no build step and installs cleanly as a git dependency.

## License

MIT (c) 2026 ZAAI. Built and maintained by [ZAAI](https://zaai.com). Sibling project: [Jekyll-AEO](https://github.com/ZAAI-com/Jekyll-AEO).
