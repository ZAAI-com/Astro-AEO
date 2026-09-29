# EmDash Portfolio template recipe

A thin mirror of EmDash's **Portfolio** template (`npm create emdash@latest -- --template portfolio`) at
EmDash 1.0.1: the same routes, collections, and seed content, with plain markup instead of the
template's styling and without the remote sample images. It shows what `emdashAeo()` does for a site
scaffolded from that template. The [emdash](../emdash/) recipe shows a site that mixes templates.

To add Astro-AEO to your own Portfolio site, install `astro-aeo` and add one integration after
`emdash()`:

```js
import emdashAeo from 'astro-aeo/emdash';

integrations: [react(), emdash({ /* ... */ }), emdashAeo()],
```

## What ends up in `llms.txt`

| Route | Source | Listed |
|---|---|---|
| `/`, `/work`, `/contact` | fixed pages | yes |
| `/work/{slug}` | `projects`, pattern `/work/{slug}` | every published project |
| `/about` | `pages`, pattern `/{slug}`, served by the fixed `about.astro` | yes, once |
| `/rss.xml`, `/404`, `/_emdash/**` | | no |

No options are needed.

## Run it

```bash
cd recipes/emdash-portfolio
npm run db:setup   # creates data.db from seed/seed.json (emdash seed)
npm run dev        # http://localhost:4321, admin at /_emdash/admin
npm run build && npm start
curl -H "Host: recipe.example.com" http://127.0.0.1:4321/llms.txt
curl http://127.0.0.1:4321/work/volta-web.md
```

Requires Node 22.16 or newer (EmDash's requirement). Aggregate files are answered for the configured
`site` origin, hence the `Host` header.
