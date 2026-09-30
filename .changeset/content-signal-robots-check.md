---
'astro-aeo': patch
---

Accept `Content-Signal` lines in the `robots.txt` checks of `astro-aeo validate` and
`astro-aeo audit`. With `discovery.robots.contentSignals` set, the `robots.txt` Astro-AEO writes
drew a `robots-unknown-line` warning for every group, so `validate --strict` and
`audit --fail-on warning` failed on Astro-AEO's own output. A `Content-Signal` line whose value is a
comma-separated list of `search`, `ai-input` and `ai-train` set to `yes` or `no`, each at most once,
is now accepted. A malformed one still warns with the same code and message. Generated files are
unchanged.
