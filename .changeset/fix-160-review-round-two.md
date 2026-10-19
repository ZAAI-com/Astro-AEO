---
"astro-aeo": patch
---

Fix further 1.6.0 defects found in review.

- `astro-aeo validate` and the offline audit accept a versioned corpus manifest: locale records, page locale references and canonical-artifact precedence are now keyed by version, so one locale record per version is no longer a duplicate.
- Page snapshots and processing traces of a build whose pages render on demand report `inventoryComplete: false`, so `report changes` marks those pages unconfirmed instead of removed. `report rag` treats runtime-owned artifacts as incomplete and no longer skips companions whose names start with `llms`.
- A negotiated `303` redirect keeps the page's own `Cache-Control` instead of `markdown.cacheControl`.
- Audit exports redact credentials embedded in another URL's query, `report graph` rejects credentialed URLs in any scheme case, and `report`/`audit` outputs can be written under macOS `/tmp`.
- Live discovery accepts a domain profile that names the site origin above the deployment base and resolves relative page canonicals before comparing them with the sitemap.
- `astro-aeo doctor --dist` keeps a build folder reached through a link inside the project unread.
- Page alternates must be objects, the OTLP sink sends a fractional sample rate as `doubleValue`, the JSONL sink checks parent paths with Windows separators, and a sparse `sameAs` array is rejected.
- RAG artifact recounts use the stage cache, trailing headings appear in a record's `headings`, tab labels honor ancestor-dependent `removeSelectors` and `aria-labelledby`, and an `entity: false` graph node is located like it is collected.
- Audit languages compare case-insensitively, audit locations skip `<template>` contents, indented fences and multi-backtick code spans, and the local audit reads only a bounded, regular corpus manifest.
- Published schemas now encode what the producers enforce: kind-specific RAG ids, public HTTP(S) URLs, safe root-relative pathnames, at least one record per RAG index file, an uncapped trace stage list, safe traffic path keys, analytics event pairings and the analytics adapter constraints.
