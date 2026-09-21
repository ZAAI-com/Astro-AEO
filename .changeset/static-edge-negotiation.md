---
'astro-aeo': minor
---

Add opt-in static edge negotiation for sites without an adapter. `cloudflareEdge()`, `netlifyEdge()` and
`vercelEdge()` (from `astro-aeo/edge/cloudflare`, `/netlify` and `/vercel`) make the build emit
`/.well-known/astro-aeo-edge-v1.json`, listing only the companions it really emitted, and
`createCloudflareHandler()`, `createNetlifyHandler()` and `createVercelHandler()` negotiate from it in
the host's edge layer with the same rules as the Astro middleware: `GET` and `HEAD`, exact routes,
Markdown only when it strictly outranks HTML, `303` in redirect mode, `Vary: Accept` on every listed
route, and the unmodified HTML response whenever the manifest or a companion is missing, malformed or
stale. `astro-aeo/edge` exports the manifest type and the shared decision function. The plugin is
rejected when the project has an adapter, renders a page on demand, or sets `markdown.negotiation` to
`'off'`. The Cloudflare handler is tested in workerd; no handler has been verified on a deployed provider.

Every build now also writes the private `.astro/aeo-cache/deployment-v1.json` (mode `0o600`) with the
output mode, adapter name, base, build format, trailing slash, negotiation mode, edge provider and an
ownership digest. It contains no path and no secret. A project that uses none of this emits the same
public bytes as before.
