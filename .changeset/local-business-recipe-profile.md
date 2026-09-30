---
'astro-aeo': patch
---

Fix the `local-business` recipe so it emits the domain profile its README promises. Its config set a
nonexistent `discovery.domainProfile` with a `contactEmail`, which was ignored with an unknown-key
warning, so `/.well-known/domain-profile.json` was never written. It now uses
`site.profile` with `enabled`, `name`, `description` and `email`. The recipe suite now fails when any
recipe logs an unknown config key, and checks the local-business profile. The published package
is unchanged.
