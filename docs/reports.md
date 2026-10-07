# Read-only reports

Reports consume observations, sanitized build evidence, and available public artifacts. They
never execute consumer configuration, user modules, hooks or tokenizers, crawl a site, or
write migrations. No report is proof of deployed provider behavior.

```sh
astro-aeo report traffic observations.jsonl --from 2026-10-01 --to 2026-11-01 --format json
cat server.log | astro-aeo report traffic - --weighted --bucket minute
astro-aeo report changes --baseline previous-pages-v1.json --format markdown
astro-aeo report inspect . --page '/guide/**' --format json
astro-aeo report graph dist/schema/graph.jsonld --output graph.html
astro-aeo report rag . --format jsonl --output private/rag.jsonl
```

All five commands support `--format terminal|json|markdown|html` and `--output <file>`.
Graph defaults to HTML; RAG additionally supports JSONL and defaults to it. Other defaults
are terminal output. Warnings are available in report envelopes and on stderr, so JSONL
stdout remains ingestion-ready. Malformed-input or invocation failures exit 2. Successful
reports exit 0 unless an explicitly configured changes gate fails, which exits 1.

Each input is limited to 16 MiB of UTF-8. Streaming stdin and URL responses are capped while
reading. Traffic accepts at most 100,000 events and 64 KiB per event line. Private RAG files
share one 16 MiB budget. Companion discovery is bounded to 100,000 directory entries, 32
levels, and 16 MiB of combined companion text. Graph traversal is capped at 100,000 visits,
32 levels, 10,000 nodes and 50,000 edges. Split large observation logs into bounded windows;
this release does not ingest host logs or execute arbitrary JSON schemas.

Project evidence and discovered companions refuse symlinked directories and files. The check
covers the selected project (or the working directory) and everything below it; folders above
it, such as a symlinked home directory, are the environment's choice and are not inspected. Explicit
output uses an atomic sibling transaction and mode `0600`, refuses symlink targets, and
does not modify inputs. Outputs cannot overwrite consumed inputs, companions or private build evidence. Default evidence is `.astro/aeo-cache` beneath the selected project.
Exported content can contain authored Markdown: keep private RAG exports separate from
content-free snapshot and trace evidence.

## Traffic

`report traffic [file|-]` accepts JSONL events or console lines beginning exactly
`astro-aeo:analytics-v1 `. Unmarked console chatter is ignored when marked events are present.
Malformed marked events and forbidden request fields are rejected, not counted.

`--from` is inclusive; `--to` is exclusive. Date-only filters use UTC midnight. Full timestamps
must be `YYYY-MM-DDTHH:mm:ss.000Z`. `--bucket day` is the default, with `minute` also available.
Reports include observed totals and buckets by time, bounded path, claimed crawler,
representation and status. They disclose sample rates, scopes, surfaces, registry versions
and `observable-only` coverage. Crawler identity is a User-Agent claim, not authentication.

`--weighted` additionally sums `1 / sampleRate` for matched events. This is an
inverse-probability estimate, not measured full-site traffic. Missing surfaces, failures and
coverage gaps cannot be estimated from observations. No IP, query, referrer, cookie,
authorization or raw-header fields are accepted. Reports neither deduplicate nor infer
unobserved visits.

## Changes

`report changes [current-snapshot] --baseline <file|URL>` compares snapshot v1 page component
hashes and artifact ownership etags. The default current snapshot is
`.astro/aeo-cache/pages-v1.json`. Page identity is pathname, locale and content version.
Artifact identity is public pathname. Source, HTML, Markdown, metadata, graph and
directive changes are listed separately; private RAG hash changes are also disclosed.

The default `--fail-on none` never treats a content change as an invocation failure.
Choose `added`, `changed`, `removed` or `any` to gate on confirmed changes. Incomplete or
digest-mismatched current inventories cannot confirm removals; incomplete baselines cannot
confirm additions. Unconfirmed entries do not trip the gate. Digest warnings remain visible.

URL baselines must be explicit HTTP(S), without credentials or fragments. Requests have a
two-second timeout, reject redirects, enforce the byte cap, and resolve no references.
Snapshots contain hashes and public route patterns, not source bodies, absolute source paths,
timestamps or raw diagnostics.

## Inspect

`report inspect [project]` joins snapshot v1, optional trace v1, and the default
`dist/llms/manifest.json` when available. Use `--manifest <file>` for another emitted manifest,
`--dist <dir>` for a custom output location, and repeatable `--page <glob>` to select routes.

The report exposes component hashes, sanitized stage outcomes, renderer/source strategies,
graph provenance counts, transform owners, diagnostic counts, companion hashes and token
counts. Missing trace and inconsistent snapshot/trace/deployment/ownership identities are
warnings, not assurances. Public manifests have no build digest: their exact bytes are
compared with snapshot ownership etags instead. Selection does not rewrite or delete anything.

## Graph

`report graph [file]` defaults to `dist/schema/graph.jsonld`; choose an explicit path when
your graph artifact uses a custom destination. It extracts JSON-LD nodes and references
without resolving `@context` or fetching linked IDs. `--type <type>`, `--node <ID>`, and
`--depth 0|1|2|3` select types and undirected neighborhoods.

HTML provides local search, type and neighborhood controls, plus complete initial nodes
and edges tables for readers without JavaScript. IDs and labels are inert text, never
data-derived HTML or executable URLs. No remote assets are loaded. Exact inline script
and style bytes are SHA-256 pinned in a restrictive CSP; there are no inline handlers.
Audit HTML receives equivalent style-only CSP protection. Graph URLs containing credentials
or query values are refused; JSON-LD labels and identities remain authored claims.

## RAG

`report rag [project]` first reads private `rag-v1/index-v1.json` and its indexed locale
and version JSONL files. It validates file and record hashes, record identities, count
contracts, and built-in approximate counts. It warns on snapshot/index/content digest
mismatch and discloses runtime-owned or incomplete build inventories. Custom-tokenizer
counts are preserved as declared measurements, not independently recalculated.

Without private records, it reconstructs records from available build companions and an
optional corpus manifest, using the shared heading-aware block planner and built-in
`astro-aeo-approx@1` tokenizer. It works without prior `corpus.rag` enablement.
`--dist <dir>` selects output, `--manifest <file>` supplies page locale/version metadata,
and `--max-tokens <n>` controls reconstructed chunks (default 512). Existing private
records retain their build-time budget. Repeatable `--page <glob>` filters exports.

Generated scalar frontmatter is removed from reconstructed text. Without a manifest,
published URL frontmatter is used; otherwise supply `--origin https://example.com` and an
optional `--base /docs`. Without a manifest, locale/version/index eligibility may be
unavailable. Missing companions and unestablished runtime inventory are disclosed.
Companion reconstruction cannot recover private index directives or plugin drop decisions.
Reconstruction exports available published text, not unavailable source, and may differ
from private records in trailing newline/footer metadata. Whole fences and indivisible
blocks remain intact; oversized chunks are disclosed. See [ingestion examples](rag.md).

## Versioned contracts

Package schema subpaths include `analytics-event.schema.json`, `analytics-report.schema.json`,
`changes-report.schema.json`, `page-snapshot.schema.json`, `processing-trace.schema.json`,
`inspect-report.schema.json`, `graph-report.schema.json`, `rag-report.schema.json`,
`rag-record.schema.json` and `rag-index.schema.json`. Their current wire version is 1.
Corresponding report and private evidence declarations are exported from `astro-aeo`.
Existing `validate` and `ValidateResult` output remain frozen.
