---
'astro-aeo': minor
---

Add `astro-aeo/content` with `contentPage`, `contentDescriptor`, `defineContentCatalog` and
`defineCmsAdapter`. They build `<AeoPage>` props and page catalogs from content-collection entries and
headless CMS records, stay loadable by Node, and load through the existing catalog failure isolation.
CMS pages always carry `source.kind: 'cms'` and the source path `cms:<name>:<id>`.

Add `createTechArticle()` to `astro-aeo/schema`.

Add an optional `version` label to `PageDescriptor`, `defineAeoPage`, `AeoPageRecord`, plugin page
records and corpus manifest page entries. It is metadata only; a site without versions produces the same
bytes as before, and an invalid label is ignored with `catalog-invalid-version`.

`defineAeoPage()` is now typed consistently: its JSDoc return type matches the declared `AeoPageProps`.
