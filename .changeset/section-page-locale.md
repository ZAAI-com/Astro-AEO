---
'astro-aeo': patch
---

Type the page a `corpus.index.sections` predicate receives as the new exported `SectionPage`, an
`AeoPage` with `locale?: string | null`. Predicates already received the locale at run time, but a
`// @ts-check` or TypeScript config rejected `match: (page) => page.locale === 'en'`. `AeoPage`
itself is unchanged.
