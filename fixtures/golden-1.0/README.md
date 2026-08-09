# Astro-AEO 1.0 golden output

The `expected.json` snapshot was generated with the published 1.0 implementation at
repository commit `4a0a3f6d863f77474863ebcc3454cc2bf73227aa`. The fixture uses only 1.0
configuration keys and disables git-derived dates so every artifact is deterministic.

`src/golden-output.e2e.test.js` rebuilds this site with the current integration and
compares every output byte. The separate `config-compat` fixture continues to compare
legacy and canonical configuration spellings.
