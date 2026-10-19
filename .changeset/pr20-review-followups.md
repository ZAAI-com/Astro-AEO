---
'astro-aeo': patch
---

Fix review findings left open on the 1.6.0 release:

- `audit` export destinations and `report --output` now refuse a path that names the same file as
  another export or an input under a different letter case (on macOS and Windows) or through a hard
  link, instead of overwriting it.
- `audit --discovery` stops issuing new requests after 60 seconds and reports `live-discovery-limit`,
  so a slow origin can no longer hold discovery for 100 sequential request timeouts.
- `report inspect` warns when the ownership ledger lists an artifact the snapshot lacks, or when
  their byte lengths differ.
- Runtime plugins receive only the `requested` and `source` fields of a page's locale fallback marker.
- The Vercel edge handler applies the manifest cache policy to a direct `.md` request only after
  the asset answers `200`, so a missing companion is no longer made cacheable.
- Edge handlers match direct companion requests against the manifest after decoding, so an
  equivalent percent-encoding receives the same cache policy.
- `doctor` reports emitted artifacts as `missing` when the build folder no longer exists, instead
  of calling them unverified behind a symbolic link.
- Analytics records requests for published `rag.jsonl.gz` siblings as artifacts, and reads the
  build's gzip decision from one runtime flag instead of re-deriving it.
