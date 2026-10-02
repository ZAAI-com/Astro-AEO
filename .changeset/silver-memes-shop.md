---
"astro-aeo": patch
---

Return sanitized `503` responses with `Cache-Control: no-store` when production or preview live corpus collection fails, instead of successful partial artifacts. Apply this to all corpus variants, manifests, chunks, aliases, and schema graph/map while preserving intentional exclusions, development diagnostics, and direct authenticated Markdown responses.
