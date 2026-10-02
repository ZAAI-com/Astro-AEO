---
"astro-aeo": patch
---

Contain Google schema processing failures with bounded traversal and page-scoped warnings.
Resolve offline same-page references against the discovered deployment origin, correct URL,
graph, author and offer-currency checks, and reject unsupported Article component types.

Correct editorial exclusions and reference links, require visible citation text, interpret
offset-free dates as UTC, and capture one clock per audit. Avoid optional extraction during
default audits and omit missing component entities and empty Article authors.

Benchmark regression explanation: the review-fix snapshot measures 399,168 packed bytes and
1,523,214 unpacked bytes across 184 files. Bounded schema processing, offline URL bases,
Markdown filtering and component guards explain the growth. Move the unpacked ceiling from
1,520,000 to 1,530,000 bytes; packed, runtime bundle and performance limits stay unchanged.
