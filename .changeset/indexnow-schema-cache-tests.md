---
'astro-aeo': patch
---

Tighten the JSON schema pattern for `discovery.indexnow[].origin` so schema validation rejects non-443 ports exactly as runtime validation does, and cover the remaining Markdown renderer cache-declaration rejection branches with tests.
