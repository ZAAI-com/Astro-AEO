# Astro-AEO 1.0 golden output

The `expected.json` snapshot was generated with the published 1.0 implementation at
repository commit `4a0a3f6d863f77474863ebcc3454cc2bf73227aa`. The fixture disables git-derived
dates so every artifact is deterministic. Its sole newer setting is `schema.autoInject: false`,
which preserves the frozen HTML now that 1.2 enables managed JSON-LD by default.

The 1.0 release configured this site with 1.0 keys. Version 2.0.0 removed those keys, so
`astro.config.mjs` was translated into the canonical spelling (`pages`, `markdown`, `corpus`,
`discovery`, `site.profile`) without regenerating `expected.json`. The frozen bytes still match,
which is the proof that the translation is exact. Never refresh `expected.json` from the current
implementation.

`src/golden-output.e2e.test.js` rebuilds this site with the current integration and
compares every output byte. The separate `config-compat` fixture proves that a 1.0-spelled
configuration is rejected and names every removed key, and that a canonical build is
byte-identical to `expected-1.6.json`, the output of the published 1.6.1 release.
