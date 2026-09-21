---
'astro-aeo': minor
---

Add `astro-aeo/starlight`, a Starlight plugin (`@astrojs/starlight` 0.32 or newer, an optional peer).
`starlightAeo()` registers the integration itself, publishes each docs page's authored Markdown with
asides, tabs and cards as labeled sections, appends previous and next links, and can add a minimal
`TechArticle` entity. MDX it would have to evaluate falls back to the rendered `.sl-markdown-content`
region with the new `authored-source-fallback` diagnostic. An explicit `<AeoPage>` always wins, and the
inferred source is emitted only during collection and removed before anything is written or served.

Fix request-time ownership for catch-all pages. The dots of a rest parameter were read as a file
extension, so a project or integration page at `/[...slug]` rendered on demand owned every `.md`
companion and text artifact path, and those requests answered a bodyless `404`. A rest-parameter page
is now treated like any other generic dynamic page; `/[...slug].json` and dynamic endpoints still own
their paths.

Stop reporting `metadata-conflict` for repeated `<meta name="generator">` tags, which Astro and a
framework built on it each add.
