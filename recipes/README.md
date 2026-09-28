# Recipes

Small, complete Astro projects, one per kind of site. Each builds on its own and passes `astro-aeo audit` with no errors; `pnpm run test:recipes` proves it on every release. They are not part of the published package.

| Recipe | Shows |
|---|---|
| [marketing](marketing/) | companions, `llms.txt`, robots policy, organization graph |
| [blog](blog/) | dated posts, `ArticleJsonLd`, `llms.txt` sections |
| [starlight](starlight/) | the Starlight plugin and authored Markdown |
| [saas](saas/) | excluding an app area, `FaqJsonLd` |
| [commerce](commerce/) | product graphs from `astro-aeo/schema` |
| [local-business](local-business/) | `LocalBusiness` graph, domain profile |
| [i18n](i18n/) | locales, reciprocal `hreflang`, per-locale corpora |
| [ssr](ssr/) | Node adapter, content negotiation, a page catalog |
