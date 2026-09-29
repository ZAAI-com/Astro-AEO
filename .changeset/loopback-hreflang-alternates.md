---
'astro-aeo': patch
---

Accept plain `http:` hreflang alternates on `localhost`, `127.0.0.1` and `[::1]` in a local context:
the page is served from one of those hosts, or `astro dev` or `astro preview` is running. A page
served locally no longer fails the build with `hreflang-invalid`, and a dev or preview server no
longer answers `llms.txt`, `llms-full.txt` and the corpus artifacts with `500`. Sitemap
`xhtml:link` alternates follow the same rule in the build, `astro-aeo validate` and
`astro-aeo audit`. A production build for an https site still rejects a stray localhost alternate,
and credentials, fragments, other schemes and public `http:` hosts stay rejected everywhere.
