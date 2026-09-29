# EmDash Marketing template recipe

A thin mirror of EmDash's **Marketing** template (`npm create emdash@latest -- --template marketing`) at
EmDash 1.0.1: the same routes, collections, and seed content, with plain markup instead of the
template's styling and without the remote sample images. It shows what `emdashAeo()` does for a site
scaffolded from that template. The [emdash](../emdash/) recipe shows a site that mixes templates.

To add Astro-AEO to your own Marketing site, install `astro-aeo` and add one integration after
`emdash()`:

```js
import emdashAeo from 'astro-aeo/emdash';

integrations: [react(), emdash({ /* ... */ }), emdashAeo()],
```

## What ends up in `llms.txt`

The Marketing template's `pages` collection has no URL pattern: its entries (`home`, `pricing`,
`contact`) are rendered by the fixed routes `/`, `/pricing`, and `/contact`, which Astro-AEO already
knows. The catalog therefore lists nothing for this template, and never guesses a `/pages/home` URL.
Each page's content is a list of EmDash blocks (hero, features, testimonials, pricing, FAQ), rendered
here by `src/components/MarketingBlocks.astro` and converted to Markdown like any other page.

No options are needed.

## Run it

```bash
cd recipes/emdash-marketing
npm run db:setup   # creates data.db from seed/seed.json (emdash seed)
npm run dev        # http://localhost:4321, admin at /_emdash/admin
npm run build && npm start
curl -H "Host: recipe.example.com" http://127.0.0.1:4321/llms.txt
curl http://127.0.0.1:4321/pricing.md
```

Requires Node 22.16 or newer (EmDash's requirement). Aggregate files are answered for the configured
`site` origin, hence the `Host` header.
