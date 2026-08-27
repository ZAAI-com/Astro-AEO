---
"astro-aeo": patch
---

Avoid reading request headers while Astro prerenders static pages. HTML enrichment and marker redaction still emit fresh ETags, while Accept negotiation and conditional requests remain available for on-demand routes.
