---
'astro-aeo': patch
---

Benchmark regression explanation: against the committed 1.3 baseline the published package grows from
272,377 to about 350,713 packed bytes (about 29 percent) and from 1,106,331 to about 1,358,848 unpacked
bytes (about 23 percent; about 17 percent over 1.3.1). 1.4 ships the audit engine with seven report
formats, the doctor and fix commands, the content and Starlight helpers, and three static edge handlers
as new source files. All of it is opt-in and none of it is imported by the integration entry or the
runtime middleware: the Node and Cloudflare bundle comparisons in the same report show no regression,
and startup, memory and request overhead stay under their unchanged ceilings. The accepted tradeoff is
install size for features that need no additional package.
