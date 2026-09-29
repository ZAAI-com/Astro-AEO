# EmDash mixed-site recipe

A marketing site with a blog and customer stories, all managed in [EmDash](https://emdashcms.com/).
EmDash's templates are starting points: a real site often starts from one and adds collections. This
recipe mixes the shapes of the Marketing, Blog, and Portfolio templates and shows how `emdashAeo()`
handles all of them with one line of setup plus per-collection options. For a site that still matches
one template, see [emdash-blog](../emdash-blog/), [emdash-marketing](../emdash-marketing/),
[emdash-portfolio](../emdash-portfolio/), or [emdash-starter](../emdash-starter/). The same site on
Cloudflare (D1 and R2) is [emdash-cloudflare](../emdash-cloudflare/).

| Collection | URL pattern | Rendered by | In `llms.txt` |
|---|---|---|---|
| `sections` | none (not routable) | the fixed home page, `/` | as the home page |
| `posts` | `/blog/{year}/{month}/{slug}` | `src/pages/blog/[year]/[month]/[slug].astro` | under `## Blog` |
| `customers` | `/customers/{slug}` | `src/pages/customers/[slug].astro` | under `## Customers` |
| `legal` | `/legal/{slug}` | `src/pages/legal/[slug].astro` | no: `legal: false` |

## How it fits together

- `emdashAeo()` registers Astro-AEO itself. It excludes `/_emdash/**` (the admin and API) and the 404
  page, leaves `robots.txt` and sitemaps to EmDash, turns on content negotiation, and adds a page
  catalog.
- The catalog asks EmDash for every collection with a URL pattern and lists its published entries,
  skipping drafts, deleted entries, and entries marked noindex in the SEO panel. It uses EmDash's own
  read API through the project's `emdash` install, so it never opens `data.db` itself.
- `collections.posts.section: 'Blog'` gets its URLs from the seed's `urlPattern`: `/blog/**`.
- Publishing in the admin shows up in `llms.txt` within 10 seconds (`revalidate`), without a restart.

## Requirements

Node 22.16 or newer (EmDash's requirement) and Astro 6.3 or newer for request-time corpora.

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
curl http://127.0.0.1:4321/customers/aeo-field-guide.md
```

Aggregate files are answered for the configured `site` origin, hence the `Host` header. EmDash
stamps seeded posts with the time of seeding, so their dated URLs carry the current year and month.
To use the admin, complete EmDash's one-time setup wizard (passkey registration) in the browser.
