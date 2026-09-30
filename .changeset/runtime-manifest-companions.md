---
'astro-aeo': patch
---

List `.md` companions in corpus manifests served at request time. Under `astro dev`, or a server
build whose corpus the middleware owns, `/llms/manifest.json` gave every page `markdownUrl: null`
and no `tokenCount` or `hash`, although the middleware serves each page's `.md`. Such a manifest now
lists the companion URL, its token count and its hash. Pages opted out with `no-dotmd`,
`generateMarkdown: false` or `markdown.enabled: false` stay `null`. Output changes only for
request-time manifests; build manifests are unchanged.
