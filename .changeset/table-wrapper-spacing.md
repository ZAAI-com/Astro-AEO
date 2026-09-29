---
'astro-aeo': patch
---

Keep words apart when a table kept as HTML unwraps styling-only `<div>` and `<span>` wrappers. Two
spans that CSS laid out as separate blocks, such as `<span>Pilot</span><span class="block">Fleet</span>`,
used to read "PilotFleet" once their classes were stripped. Adjacent wrappers now get one space
between them, using the same tag rule definition terms use since 1.5.0. Inline tags such as `<b>`,
`<a>` and `<code>`, plain text next to a wrapper, and closing punctuation stay attached. A word split
across two bare spans gains a space.
