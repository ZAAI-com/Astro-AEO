---
'astro-aeo': patch
---

Fix two request-time regressions exposed by the latest Astro and EmDash releases.

- Astro 7.4's Node adapter, like Astro 6's, keeps a request's `Host` header only for domains listed in `security.allowedDomains`. Without it, `llms.txt`, `llms-full.txt` and the corpus paths see a `localhost` origin and answer 404. A Node build whose corpus is served at request time now warns and names each missing hostname with a paste-ready `security.allowedDomains` block, and the README no longer says Astro 7 keeps the header without it.
- On Cloudflare Workers, a revalidating page catalog (such as the EmDash catalog) could keep its first listing forever: the background refresh was cancelled when the request that started it finished, and never settled. The middleware now hands the refresh to `locals.cfContext.waitUntil`, so newly published entries appear after the `revalidate` window again.
