---
'astro-aeo': patch
---

Document Astro 7.3 compatibility for Cloudflare and cached negotiation.

The integration needs no code change on Astro 7.3. Two consumer-facing notes were
added to the README: a hand-written `astro/fetch` Cloudflare entrypoint must call
`finalize(state, response)` so cookies merged during a direct `.md` rewrite still
reach the client, and Astro's `memoryCache()` now skips responses carrying
`Vary: Cookie` or `Vary: *`, which negotiated responses do not.
