---
'astro-aeo': patch
---

Keep stale outputs when the processing cache is read-only. A build whose cache was locked by
another process, or whose cache state was invalid, still deleted the outputs the previous build
wrote and this one no longer claims, although the README promises such a build has no stale
deletion authority. It now keeps them, records them in the ownership ledger again, and warns once,
so the next build with a writable cache removes them. Output changes only for such a build: stale
files survive it. A disabled cache (`cache.enabled: false`) still deletes stale outputs as before.
