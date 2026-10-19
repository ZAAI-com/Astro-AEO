---
"astro-aeo": patch
---

Fix four 1.6.0 defects found in review.

- `astro-aeo doctor`, the local audit and `report inspect` no longer report a build mismatch after a build keeps stale outputs (an incomplete page inventory or a read-only processing cache). Deployment facts and the page snapshot now hash the same artifact list the ownership ledger records.
- `markdown.cacheControl` now replaces the cache policy of successful and `304` Markdown responses only. Markdown rendered from an error page keeps that page's own policy, so a long-lived value cannot cache a 404 or 500.
- `report graph` keeps an embedded entity without an `@id` (such as an author `Person`) as its own `_:` node with an edge from its parent, instead of overwriting the parent's label and types.
- Pure plugin hook cache keys now include the plugin's declared `runtime.options`, so changing them reruns the hook. The README now documents that a cache hit skips hook execution.
