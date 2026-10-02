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

Benchmark regression explanation (before these review corrections): against the committed 1.4
baseline the published package grows
from 350,713 to about 394,824 packed bytes (about 13 percent) and from 1,358,848 to about 1,504,346
unpacked bytes (about 11 percent; about 3 percent over 1.5.2). The growth is the eight new JSON-LD
components, the shared Google field checker, the editorial audit rules, and their documentation.
Only components a page imports and the checker reach a consumer bundle, and the measured package
remains below the updated unpacked safety ceiling.

After the review corrections, the package measures 397,368 packed and 1,515,305 unpacked bytes
across 184 files. Immutable graph consolidation, subject identity and visible-prose/citation checks
add 10,959 unpacked bytes over the pre-review state. The measured 5,305-byte overage moves only the
unpacked ceiling by 10,000 bytes to 1,520,000; packed, runtime bundle and performance limits stay
unchanged.
