---
'astro-aeo': patch
---

Keep the development corpus complete when two dynamic route patterns overlap

Astro's `findRouteToRewrite` commits to the first route whose pattern matches the requested
path, and its only way to reject a route that matches without producing the path reads
`route.distURL`, which is populated only while a build writes files. In `astro dev` that check
can never run, so a dynamic route that owns nothing shadows the route that owns the path and
every in-process rewrite to it throws.

A `src/pages/[year]/` route with no entries alongside `src/pages/[...slug].astro` is the common
shape. Ordinary requests were unaffected and so was the build, but every page behind the
shadowed route silently vanished from `llms.txt`, `llms-full.txt` and the schema corpus, and its
`.md` companion returned an empty 404 with nothing written to the terminal.

Three changes:

- Failed internal rewrites are recorded instead of discarded. In development Astro-AEO now warns
  once per server, naming the first affected path, how many others followed, and the cause, and
  answers an affected `.md` request with that reason rather than an empty 404. Production still
  fails closed, and its responses are unchanged.
- Development recovers the page by re-requesting it from the address Astro reported at startup,
  so the corpus and companions stay complete. This is reached only after an in-process rewrite
  has already failed, only for renders that were already anonymous, and it is never present in a
  production or adapter bundle.
- The two development discovery warnings no longer suppress each other. A project with both an
  on-demand dynamic page and `pages.devDynamicDiscovery: false` previously heard about only the
  first of the two.
