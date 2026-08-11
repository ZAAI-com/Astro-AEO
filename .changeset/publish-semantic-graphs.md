---
"astro-aeo": minor
---

Add the complete 1.2 semantic publishing surface and finish universal representation parity.
Publish deterministic Schema.org graph helpers, `AeoHead`, importable Markdown renderers, optional
MDX and Defuddle adapters, plugin API v1, transactional artifact ownership, runtime provider
fallbacks, and opt-in experimental schema corpora. Managed graph injection now defaults to enabled,
the shared `AeoPageRecord` is richer, and project routes and `public/` files own collisions unless
their exact served pathname is explicitly replaced.

Benchmark regression explanation: the complete semantic graph, runtime plugin, transactional
ownership, and optional adapter surface intentionally expands the shipped ESM; 1.2 establishes a
new measured package and bundle baseline for this accepted release scope.
