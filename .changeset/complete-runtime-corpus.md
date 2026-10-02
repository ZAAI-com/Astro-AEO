---
"astro-aeo": patch
---

Return a sanitized, non-cacheable 503 when a known live-corpus page cannot be rendered or its HTML cannot be read completely. Preserve anonymous authorization, redirect, missing-route, non-HTML and page opt-out exclusions, along with existing plugin and semantic validation failures.
