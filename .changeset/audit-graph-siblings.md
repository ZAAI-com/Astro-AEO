---
'astro-aeo': patch
---

Resolve JSON-LD references across the whole page in `astro-aeo audit`. The audit validated each
entity on its own, so a reference to a sibling in the same `@graph`, such as a `WebPage` whose
`breadcrumb` points at the page's `BreadcrumbList`, drew a false `schema.unresolved-reference`
warning, as did a reference to an entity in another script on the page. Each entity is still
checked alone for errors, and references are now resolved once over every valid entity of the page,
as the build does. A reference nothing on the page defines still warns. Audit output changes only by
the removed false warnings; generated JSON-LD is unchanged.
