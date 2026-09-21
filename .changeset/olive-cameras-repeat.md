---
'astro-aeo': patch
---

Stand down from injecting a runtime fallback route for an exact artifact path the project already
routes itself. Astro exposes `injectRoute` only before any route is resolved and has no
`removeRoute`, so a project page at `src/pages/llms.txt.ts` previously ended up competing with an
injected route for the same path: Astro warned that a static route was defined twice, and the
injected route could win the match and answer its bodyless 404 in place of the project's response.
Injection now checks the project's page files for that one path and skips it, covering every
supported page and endpoint extension in both the `llms.txt.ts` and `llms.txt/index.ts` spellings.
