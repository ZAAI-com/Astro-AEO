---
'astro-aeo': patch
---

Correct three documented guarantees. The README said the static edge handlers fail closed to the
HTML on a stale manifest everywhere; on Vercel, where the handler rewrites to the companion, a
companion that a stale manifest still lists but that is gone gets the platform's `404`. The README
said request contracts run for the Vercel and Netlify handlers; those run in process against a
smaller set, while the full contract runs for Node, Cloudflare in workerd and Deno. `SECURITY.md`
now names the development-only loopback that re-requests one page from the dev server's own
address after an in-process rewrite fails. The cache-lock paragraph now says what a read-only build
does with stale files and when a lock or an invalid state clears. No behavior changes.
