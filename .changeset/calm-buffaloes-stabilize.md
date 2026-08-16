---
'astro-aeo': patch
---

Stabilize semantic publishing across build and runtime by preserving canonical URL bases, reconciling plugin graphs, aligning artifact ownership and exact-path validation, and correcting the public schema ID contracts.

Benchmark regression explanation: The Node integration bundle grows by about 17 percent raw and 15 percent gzip because runtime-safe semantic graph reconciliation and fail-closed plugin pathname validation now ship in the consumer server bundle. This is the accepted cost of preserving authored JSON-LD and matching build/runtime ownership behavior; all absolute bundle, startup, memory, and request ceilings remain enforced.
