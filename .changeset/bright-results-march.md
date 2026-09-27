---
'astro-aeo': patch
---

Fix audit coverage and request failure handling. Offline audits now read the generated
Markdown companions for directory-format pages and check same-origin absolute links and
hreflang using explicit or generated site metadata. Live audits report failed companions,
isolate response-body timeouts and interruptions, and check missing HTML language attributes.

Corrected audits may report errors that earlier versions missed. The frozen validate command,
public configuration, and audit report format are unchanged.
