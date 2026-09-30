---
'astro-aeo': patch
---

Scope the charset in the Apache snippet that `astro-aeo fix --provider apache` prints to `.md`
files. The snippet paired `AddType text/markdown .md` with `AddDefaultCharset utf-8`, which adds a
charset only to `text/plain` and `text/html` responses: `.md` companions were still served without
one, and every HTML and text response on the host was relabeled as UTF-8. It now prints
`AddCharset utf-8 .md`, so companions are served as `text/markdown; charset=utf-8` and nothing else
changes. If you copied the old snippet, replace its `AddDefaultCharset utf-8` line.
