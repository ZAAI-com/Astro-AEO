---
'astro-aeo': minor
---

The processing cache now resets once, and logs the reset, whenever the extractor changes: an
astro-aeo upgrade or downgrade, or a lockfile refresh of `turndown` or `linkedom`. Local builds no
longer emit Markdown produced by different code. A complete build prunes cache entries it did not
use, so the cache stops growing without bound. Git modification dates are no longer frozen at a
page's first extraction by later cache hits. A missing or malformed producer record in the cache
state now resets the entries instead of making the cache read-only, so it no longer blocks
IndexNow state from advancing.
