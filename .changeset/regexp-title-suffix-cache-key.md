---
'astro-aeo': patch
---

Key a RegExp `pages.stripTitleSuffix` by its source and flags in the processing cache. Every RegExp
used to reduce to `{}` in the cache key, so changing only the pattern let a warm build reuse the
titles the old pattern produced in `.md` frontmatter, `llms.txt`, `llms-full.txt` and page records
until the page HTML changed. Output changes only for such a project: its titles now follow the
current pattern. String, array and `false` suffixes keep their existing cache keys.
