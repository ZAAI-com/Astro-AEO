---
"astro-aeo": minor
---

Add opt-in score-neutral editorial advice, eight typed JSON-LD components, extended Article
publishing props, and shared Google field profiles for components and final rendered audits.
Preserve default output and Schema.org validation, with informational explanations instead of
historical Google requirements for FAQPage and TechArticle.

Correct opt-in audit checks to consolidate complementary same-ID entities, preserve per-entity
finding identity across local and live targets, distinguish reviewed subjects from standalone
profiles, honor direct Product price precedence, and accept CreativeWork Dataset licenses.
Exclude hidden prose and non-citation image/code/contact links from editorial advice, and resolve
equivalent relative and absolute same-page author IDs. Default checks and component output remain
unchanged.

Benchmark regression explanation: against the committed 1.4 baseline the published package grows
from 350,713 to about 397,368 packed bytes (about 13 percent) and from 1,358,848 to about 1,515,305
unpacked bytes (about 12 percent; about 4 percent over 1.5.2) across 184 files. The growth is the
eight new JSON-LD components, the shared Google field checker with immutable same-ID consolidation
and subject identity, the editorial audit rules with visible-prose and citation filtering, and their
documentation. Only components a page imports and the checker reach a consumer bundle. The unpacked
ceiling moves to 1,520,000 bytes; packed, runtime bundle and performance limits stay unchanged.
