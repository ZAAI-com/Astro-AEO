---
'astro-aeo': patch
---

Read a Starlight component tag whose attributes span several lines, as Prettier formats a long
`<LinkCard>`, `<Card>`, `<Aside>` or `<TabItem>`, as one tag. Before, the opening `<LinkCard` line
slipped past the unknown-component check, so the raw tag and its attribute lines were copied into
the Markdown companion without an `authored-source-fallback` diagnostic. A known component now
converts as it does on one line, and an unknown component, a computed attribute, or a tag that never
ends falls back to rendered extraction.
