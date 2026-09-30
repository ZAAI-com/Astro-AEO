---
'astro-aeo': patch
---

Mark a JUnit test case as failed only when its finding fails `--fail-on`, the same rule as the exit
status of `astro-aeo audit`. Every warning used to be a `<failure>` even when the audit exited `0`
under the default `--fail-on error`, and `--fail-on none` still reported every error and warning as
failed, so CI test reporters failed a passing run. A finding below the gate is now a passed case
with its severity and message in `<system-out>`, and the `failures` counts follow the same rule.
Output changes for `--format junit` under `--fail-on error` and `--fail-on none`; under
`--fail-on warning` it is unchanged. Other formats and exit codes are unchanged.
