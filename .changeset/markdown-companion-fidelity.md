---
'astro-aeo': minor
---

Markdown companions are more faithful to the page:

- Meaningful `aria-hidden` glyphs are kept: separators such as `→` and `·` between two runs of
  text, and box-drawing tree prefixes such as `├──`. Link arrows, icons, and emoji stay dropped.
- Bold terms in definition lists stay one bold run instead of splitting across lines or doubling
  to `****Term****`.
- Figures keep both images of a before/after comparison, separate adjacent labels with spaces,
  drop alternate images hidden from assistive technology, and no longer split code inside a
  figure with inserted spaces.
- Code fences carry their language from `language-*` or `lang-*` classes, `data-language` on the
  `pre` or `code` (Shiki, Expressive Code), or a filename at the start of a figure caption. A
  `pre` whose code starts after a newline now becomes a fence, and Expressive Code lines keep
  their line breaks.

The same output changes apply to on-demand and SSR Markdown and to `astro-aeo/extract`. IndexNow
resubmits each page whose Markdown changed, once.
