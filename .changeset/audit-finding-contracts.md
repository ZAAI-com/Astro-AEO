---
'astro-aeo': minor
---

Add the 1.4 finding contracts. `Finding`, `SourceLocation`, `AuditCategory`, `AuditScores` and
`AuditReportV1` are exported from `astro-aeo`, and the report wire format ships as
`astro-aeo/audit-report.schema.json`. Every existing build diagnostic, validator, sitemap and schema
graph `code` is registered unchanged as a `ruleId` with a category, a usual severity and a help link
into the new `docs/rules.md`. The advisory `astro-aeo-readiness-v1` score weighs an error at 15 and a
warning at 5, caps one rule at 30 points per category, and never affects an exit status. The
`validate` command and its JSON output are unchanged.
