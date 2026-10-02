---
"astro-aeo": minor
---

Add opt-in score-neutral editorial advice, eight typed JSON-LD components, extended Article
publishing props, and shared Google field profiles for components and final rendered audits.
Preserve default output and Schema.org validation, with informational explanations instead of
historical Google requirements for FAQPage and TechArticle.

Benchmark regression explanation: against the committed 1.4 baseline the published package grows
from 350,713 to about 394,824 packed bytes (about 13 percent) and from 1,358,848 to about 1,504,346
unpacked bytes (about 11 percent; about 3 percent over 1.5.2). The growth is the eight new JSON-LD
components, the shared Google field checker, the editorial audit rules, and their documentation.
Only components a page imports and the checker reach a consumer bundle, and the measured package
remains below the updated unpacked safety ceiling.
