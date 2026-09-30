---
'astro-aeo': patch
---

Stop publishing raw MDX from `defineAeoPage({ source })`, `contentPage()`, `contentDescriptor()` and
`defineContentCatalog()`. The `body` of an `.mdx` content entry, with its `import` lines and JSX,
used to become the page's `.md` companion and corpus text verbatim, even with `astro-aeo/mdx`
registered. An MDX body now goes to a registered Markdown renderer as `source.body`, so
`astro-aeo/mdx` converts it, and without one the page's rendered HTML is extracted. Output changes
for such pages: their Markdown no longer contains raw MDX. Explicit `markdown` still wins, and
`.md` entries are unchanged.
