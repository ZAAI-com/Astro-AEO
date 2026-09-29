# EmDash Blog template recipe

A thin mirror of EmDash's **Blog** template (`npm create emdash@latest -- --template blog`) at
EmDash 1.0.1: the same routes, collections, and seed content, with plain markup instead of the
template's styling and without the remote sample images. It shows what `emdashAeo()` does for a site
scaffolded from that template. The [emdash](../emdash/) recipe shows a site that mixes templates,
and [emdash-cloudflare](../emdash-cloudflare/) shows the Cloudflare wiring, which leaves these
options unchanged.

To add Astro-AEO to your own Blog site, install `astro-aeo` and add one integration after
`emdash()`:

```js
import emdashAeo from 'astro-aeo/emdash';

integrations: [react(), emdash({ /* ... */ }), emdashAeo({
  taxonomies: { category: '/category/{slug}', tag: '/tag/{slug}' },
  aeo: { pages: { exclude: ['/search'] } },
})],
```

## What ends up in `llms.txt`

| Route | Source | Listed |
|---|---|---|
| `/`, `/posts` | fixed pages | yes |
| `/posts/{slug}` | `posts`, pattern `/posts/{slug}` | every published post; the draft `work-in-progress` is not |
| `/pages/{slug}` | `pages`, pattern `/pages/{slug}` | `/pages/about` |
| `/category/{slug}`, `/tag/{slug}` | `taxonomies` option | terms that have published posts |
| `/search` | fixed page | no: excluded, it is a query |
| `/rss.xml`, `/404`, `/_emdash/**` | | no |

EmDash stores no URL for a taxonomy, so the archive routes are named in `taxonomies`.

## Run it

```bash
cd recipes/emdash-blog
npm run db:setup   # creates data.db from seed/seed.json (emdash seed)
npm run dev        # http://localhost:4321, admin at /_emdash/admin
npm run build && npm start
curl -H "Host: recipe.example.com" http://127.0.0.1:4321/llms.txt
curl http://127.0.0.1:4321/posts/the-case-for-static.md
```

Requires Node 22.16 or newer (EmDash's requirement). Aggregate files are answered for the configured
`site` origin, hence the `Host` header.
