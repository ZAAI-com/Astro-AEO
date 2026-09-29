---
'astro-aeo': patch
---

`FaqJsonLd` no longer fails a page render on a malformed `id`, such as `"http://["`, and no longer
gives the FAQPage the page's own URL as its `@id` for `id=""`, `"   "` or `"./"`, which collided with
the page's `WebPage` `@id`. Such an `id` is now omitted, and the existing
`schema-map-anonymous-entity` warning reports the anonymous FAQPage. A valid `id`, such as `#faq`
or an absolute URL, resolves as before, and without a `site` a non-blank `id` is still emitted as
written.
