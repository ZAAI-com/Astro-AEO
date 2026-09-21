---
'astro-aeo': minor
---

Add `astro-aeo audit [distDir|URL]`. It runs every `validate` check and adds site-wide rules for
broken internal links and anchors, duplicate titles, descriptions and canonicals, Markdown companion
quality, JSON-LD validity and hreflang targets, and it reads the build's private diagnostics and
ownership manifests when they are present. Reports render as `terminal`, `json`, `sarif`, `html`,
`markdown`, `github` or `junit` from one deterministic `AuditReportV1`, with `--output`, `--fail-on`,
and `--no-score`. A URL target is crawled anonymously within an origin allowlist, bounded by
`--max-pages`, `--timeout`, `--concurrency`, five redirects and a 5 MiB body cap. Exit codes are `0`
pass, `1` findings at or above the gate, and `2` for a bad invocation or an unreachable target.

`validation.onBuild: 'recommended'` now also gates on the audit rules a build can answer from its page
model. With the default `failOn: 'error'` the one new blocking rule is `markdown-empty`, a Markdown
companion with no text. `'artifacts'` and `'off'` are unchanged, and so is `validate`.
