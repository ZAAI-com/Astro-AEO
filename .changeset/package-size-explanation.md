---
'astro-aeo': patch
---

Benchmark regression explanation: the published package grows from 1,163,361 to about 1,358,848
unpacked bytes (about 17 percent) because 1.4 ships the audit engine with seven report formats, the
doctor and fix commands, the content and Starlight helpers, and three static edge handlers as new
source files. All of it is opt-in and none of it is imported by the integration entry or the runtime
middleware, so a consumer's server and Worker bundles, startup time and request overhead are held by
their own unchanged ceilings. The accepted tradeoff is install size for features that need no
additional package.
