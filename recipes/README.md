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
| [emdash](emdash/) | an EmDash marketing site with a blog and customers, mixing all template types |
| [emdash-blog](emdash-blog/) | EmDash's Blog template: posts, pages, taxonomy archives, an excluded search page |
| [emdash-marketing](emdash-marketing/) | EmDash's Marketing template: fixed pages built from content blocks |
| [emdash-portfolio](emdash-portfolio/) | EmDash's Portfolio template: projects and an about page |
| [emdash-starter](emdash-starter/) | EmDash's Starter template: posts and pages at the site root |

The EmDash recipes render on demand, so `pnpm run test:recipes` seeds each one, starts its built
server, and checks `llms.txt`, companions, and negotiation against the seeded content. EmDash needs
Node 22.16 or newer.
