# EmDash on Cloudflare recipe

The [emdash](../emdash/) mixed site (a marketing home, a dated blog, and customer stories) on
Cloudflare: `@astrojs/cloudflare`, EmDash's D1 database and R2 media storage, and EmDash's Worker
entry. EmDash's `-cloudflare` template variants differ from the Node ones only in this wiring, so
the `emdashAeo()` options are exactly the Node recipe's.

```js
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare';
import emdash from 'emdash/astro';
import { d1, r2 } from '@emdash-cms/cloudflare';
import emdashAeo from 'astro-aeo/emdash';

adapter: cloudflare(),
integrations: [
  react(),
  emdash({ database: d1({ binding: 'DB', session: 'auto' }), storage: r2({ binding: 'MEDIA' }) }),
  emdashAeo({ collections: { posts: { section: 'Blog' }, customers: { section: 'Customers' }, legal: false } }),
],
```

## How it works on Cloudflare

- The catalog uses no Node APIs. EmDash opens a D1 session for each request, and the catalog reads
  through that same session, so there is no database file or build-time export to maintain.
- Entries published in the admin appear in `llms.txt` within 10 seconds (`revalidate`), without a
  redeploy.
- `wrangler.jsonc` names the `DB` (D1) and `MEDIA` (R2) bindings and points `main` at
  `src/worker.js`, EmDash's Worker entry with its scheduled maintenance handler.
- `server.allowedHosts` lets `astro preview` answer for `recipe.example.com`, because `llms.txt` is
  only served for the configured `site` origin.

## Run it locally

`astro preview` runs the built Worker in workerd, with D1 and R2 simulated by Miniflare under
`.wrangler/`. No Cloudflare account is needed.

```bash
cd recipes/emdash-cloudflare
npm run build
npm run preview    # http://localhost:4321; the first request creates and migrates the local D1
```

EmDash applies the schema on the first request. Add the sample content through the admin's setup
wizard (`/_emdash/admin`), or seed the local D1 file with EmDash's CLI:

```bash
npx emdash seed seed/seed.json --database .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
curl -H "Host: recipe.example.com" http://127.0.0.1:4321/llms.txt
```

Deploy with `npm run deploy` after creating the D1 database and R2 bucket named in
`wrangler.jsonc` in your Cloudflare account.
