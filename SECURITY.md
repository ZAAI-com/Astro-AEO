# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release. When practical, a fix that
does not require a breaking API change is also backported to the preceding minor release.

| Version | Supported |
| --- | --- |
| Latest 1.x minor | Yes |
| Previous 1.x minor | Best effort |
| Older releases | No |

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue, discussion, or pull request.
Use GitHub's private vulnerability reporting for this repository:

https://github.com/ZAAI-com/Astro-AEO/security/advisories/new

Include the affected version, deployment/runtime, reproduction steps, expected impact, and any
suggested mitigation. Avoid including production secrets or personal data. Maintainers will
acknowledge a complete report within five business days and will coordinate remediation and
disclosure through the private advisory.

Astro-AEO processes rendered HTML and writes public artifacts, so reports involving path
traversal, marker disclosure, unsafe HTML retention, authentication bypass, secret leakage, or
cross-runtime bundle execution are especially helpful.

## Security boundaries

### Graphs and managed head output

- Schema helpers reject cyclic JavaScript values, prototype keys, credential-bearing or unsafe
  identifiers, and unresolved same-document references. Serialization is deterministic and escapes
  values that could terminate an inline JSON-LD script.
- Graph IDs derive only from authored IDs, explicit bases, or configured stable canonical URLs.
  Request hosts, localhost, and loopback addresses are never used as graph identity.
- Existing JSON-LD is parsed locally without fetching remote contexts and is never rewritten.
  Malformed third-party scripts are omitted from Astro-AEO's normalized view while the original
  authored bytes remain unchanged.
- `AeoHead` and `AeoPage` use escaped internal markers. Marker removal is a confidentiality step,
  not an optional enrichment, and still runs when validation prevents other changes from being
  committed.

Schema.org vocabulary coverage and graph validity do not establish Google rich-result eligibility
or guarantee placement in any answer engine. The experimental schema corpus is an Astro-AEO format,
not a standardized discovery protocol. Dated manual external checks for the release are tracked in
the [1.2 semantic validation record](docs/release-evidence/1.2.0-semantic-validation.md).

### Plugins and optional renderers

- Plugin hook inputs are immutable. Runtime plugins receive strict JSON options and safe page
  handles, never raw requests, headers, cookies, credentials, caller state, arbitrary route
  rendering, or filesystem paths.
- Plugin failures are reported with sanitized plugin/stage context. Diagnostics do not retain
  source bodies, entity values, plugin payloads, thrown values, stack traces, marker data, or
  credentials.
- Runtime artifacts claim exact app-relative pathnames and reuse Astro-AEO's method, ETag, cache,
  path-confinement, and ownership checks. Traversal, encoded separators, globs, query strings, and
  ambiguous path spellings are rejected.
- `astro-aeo/mdx` parses syntax but never compiles, imports, or evaluates ESM, JSX, or expressions.
  Unsupported semantics fall back to already-rendered local HTML.
- `astro-aeo/defuddle` accepts already-rendered local HTML only, forces `useAsync: false`, blocks
  `fetch`, and does not invoke a URL loader or remote extraction service. Optional peer installation
  alone does not activate either adapter.

### Runtime adapters and corpora

- Direct `.md` requests rewrite through the underlying application route so project middleware and
  authentication continue to apply. The response preserves the application's status, redirects,
  cookies, and relevant representation headers.
- Live corpora fan out through trusted in-process rewrites without network self-fetch. Caller
  credentials and request state are not reused. Astro 5 and Astro 6.0 through 6.2 fail closed with
  `503` and `Cache-Control: no-store`; secure full request-time corpora require Astro 6.3 or newer.
- Injected provider fallback routes are inert `404` responders when Astro-AEO pre-middleware
  declines. They do not bypass project `.md` routes or authorize replacement of project/public
  artifacts.
- Generated files are confined to validated exact paths. A prior ownership manifest permits stale
  cleanup only when Astro-AEO proves ownership and the file hash is unchanged; unknown or modified
  files are preserved.

### Audit command

- A local audit (`astro-aeo audit <dir>`) makes no network request. It never reads through a symlink, and an
  internal link is resolved only beneath the audited directory.
- A live audit (`astro-aeo audit <url>`) is anonymous. It sends no cookie, authorization, or caller
  header, refuses a URL that carries credentials, and keeps no cookie a response sets. It contacts only
  the start origin and origins named with `--allow-origin`; every redirect hop is checked against that
  list before it is followed, and at most five hops are followed.
- Live requests are bounded by a page cap, a per-request timeout, a concurrency limit, and a 5 MiB
  response cap. Response bodies are parsed as inert documents: no script runs and no subresource loads.
- Reports carry no absolute path, no source body, and no diagnostic `details`. Text from the audited
  site is escaped for each format, and control characters are replaced in terminal, GitHub annotation,
  Markdown, JUnit, and HTML output so audited content cannot forge a log line or an annotation.

### Static edge negotiation

- The edge handlers read one public build artifact, `/.well-known/astro-aeo-edge-v1.json`, and treat it
  as untrusted: a manifest that is missing, malformed, from another version, oversized, or that names an
  unsafe or non-Markdown companion path is rejected whole, and the request continues to the unmodified
  HTML response.
- They act only on `GET` and `HEAD` for exact listed routes, fetch only the manifest and listed `.md`
  companions from the deployment's own static assets, and never contact another origin. They hold no
  request state between requests and read no cookie or credential.
- The manifest lists only companions the build emitted after ownership arbitration, so it cannot
  advertise a path owned by a project route or a `public/` file.
- `.astro/aeo-cache/deployment-v1.json` is private (mode `0o600`, confined to the project root). It
  records names and modes only: no absolute path, environment value, or secret.
