---
'astro-aeo': patch
---

Serve development artifacts on projects that redirect their own `/404`. Astro resolves a redirect
route in its routing layer, before middleware dispatch, so a configuration such as
`redirects: { '/404/': '/error/' }` answered `llms.txt`, `llms-full.txt`, `robots.txt`,
`/.well-known/domain-profile.json`, `/llms/manifest.json`, and every `.md` companion with a 301
instead of reaching Astro-AEO at all. `astro dev` now injects the same fallback routes an adapter
build already receives for those projects, so the artifact paths have a concrete match. Any other
`/404`, including none, dispatches middleware on its own and nothing is injected, so development
servers that already worked are untouched.

Two behaviors follow for the affected development servers: an unclaimed `.md` path returns a
bodyless 404 rather than reaching the 404 route, and a companion whose page is prerendered is
rendered through a loopback request, because Astro forbids an on-demand route from rewriting to a
prerendered page. That forbidden rewrite is no longer reported as a rewrite failure, and a corpus
page the loopback rescued no longer warns either, since nothing was dropped. Development servers
with an adapter gain the same companion fix, where the forbidden rewrite previously produced a 404.

Build output, adapter builds, and server-output promotion are unchanged: a build without an adapter
still injects nothing, and projects that saw a 301 on `llms.txt` or a `.md` companion in development
were never affected in production.
