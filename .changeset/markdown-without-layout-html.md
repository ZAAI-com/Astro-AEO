---
'astro-aeo': minor
---

Convert figures, definition lists and simple tables to Markdown instead of copying them as raw HTML.
Real sites were getting whole `<figure>`, `<dl>` and `<table>` blocks, complete with utility classes and
`data-*` attributes, in their `.md` companions. Figures now become `![alt](src)` with the caption as an
emphasized line, definition lists become a bold term followed by its description, and tables whose cells
are single-span inline content become GFM pipe tables. `time`, `address` and `cite` convert to their text.

Tables with `colspan`, `rowspan` or block content in a cell, and `audio` and `video` (which Markdown cannot
express), stay HTML, reduced to meaningful attributes (`href`, `src`, `alt`, `scope`, `colspan`, `poster`
and similar) with attribute-less `div` and `span` wrappers unwrapped. `keepSelectors` output is unchanged.

Interface chrome is dropped before conversion: buttons (disclosure toggles with `aria-expanded` or
`aria-controls` stay), `svg`, `template`, `[hidden]` and `[aria-hidden="true"]` elements, unless they wrap
an image with alt text. Extraction diagnostics gain `keptHtmlBlocks`, and the `markdown-html-residue`
audit rule now also flags figures, definition lists and any tag still carrying `class`, `style` or
`data-*` attributes.
