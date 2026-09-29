# EmDash CMS recipe

A CMS-driven site: [EmDash](https://emdashcms.com/) manages the content, Astro renders every page on
demand, and Astro-AEO publishes the answer-engine surface. One recipe covers the three EmDash starter
template content models:

- Blog (`posts` collection): listing plus `/posts/[slug]` detail pages with `ArticleJsonLd`.
- Portfolio (`projects` collection): `/work` grid plus `/work/[slug]` case studies.
- Marketing (`sections` collection): homepage sections rendered from Portable Text with `FaqJsonLd`.

## How it fits together

- `emdash()` runs with the Node adapter and a local SQLite database (`data.db`). The admin lives at
  `/_emdash/admin` after setup; the REST API under `/_emdash/api`.
- Every content page renders on demand through `getEmDashCollection()` / `getEmDashEntry()`. There is
  no build-time HTML, so Astro-AEO's middleware owns the corpus paths at request time.
- `src/aeo-emdash-catalog.js` feeds Astro-AEO's page inventory by reading the SQLite database
  directly and listing published entries only (`defineCmsAdapter` from `astro-aeo/content`). Drafts
  and soft-deleted rows never enter `llms.txt`. EmDash's table layout (`ec_<collection>`) is internal
  and beta, so the catalog is deliberately recipe-local and fails soft to an empty list with a
  warning if the schema moves.
- `pages.exclude: ['/_emdash/**']` keeps the admin and API out of companions, negotiation, and
  corpora.
- EmDash injects its own `/robots.txt` and `/sitemap.xml` routes, so this recipe disables Astro-AEO's
  robots policy and sitemap discovery and lets the CMS own both.
- Aggregate artifacts are origin-scoped in production: a deployed server answers `llms.txt` and
  `llms-full.txt` for the configured `site` origin, not for arbitrary loopback hosts.

## Requirements

Node 22.16 or newer (EmDash's requirement) and Astro 6 or newer. Astro 6.3 or newer is needed for the
live corpus rendering this recipe exercises.

## Run it

```bash
cd recipes/emdash
npm run db:setup   # creates data.db from seed/seed.json (emdash seed)
npm run dev        # http://localhost:4321, admin at /_emdash/admin
```

Build and serve like a deployment:

```bash
npm run build
npm start          # node ./dist/server/entry.mjs
curl -H "Host: recipe.example.com" http://127.0.0.1:4321/llms.txt
curl http://127.0.0.1:4321/posts/signals-in-static-sites.md
```

The first request against an empty database runs EmDash's migrations and applies the bundled seed, so
a fresh clone serves the same content without running `db:setup` first. To use the admin, complete
the one-time setup wizard (passkey registration) in the browser.

## Cloudflare variant

EmDash also deploys on Cloudflare with D1 and R2. A catalog module cannot open D1 from a Node build
process, so on that platform feed the page inventory another way: prerender the listing paths, or
point a catalog at a JSON export of published slugs refreshed by an EmDash hook or CI step.
