# Deployment evidence and manual advice

`astro-aeo doctor [projectDir]` inspects local deployment intent. Only a successful
`--url https://example.com/page` probe can mark a serving check `configured`.
Local build facts, disabled negotiation, matching artifact bytes, server files,
and package declarations remain `unverified`. `missing` and `conflicting` checks
return exit code 1; invalid invocation returns 2.

```sh
astro-aeo doctor . --print
astro-aeo doctor . --print --json
astro-aeo doctor . --dist dist/client --url https://example.com/
```

`--print` adds manual configuration advice and examples. It never writes a
migration, imports an Astro configuration, installs a package, or runs a server.
With `--json`, advice appears as an `advice` array alongside `checks`.

## Evidence and confidence

Checks may include an `evidence` array with a project-relative `source`, a
`confidence` of `low`, `medium`, or `high`, and a short `detail`.

- Direct dependencies in `package.json` are low-confidence evidence of possible
  overlapping responsibility, not proof that an integration is active.
- Quoted package references in standard Astro config filenames are medium-confidence
  textual evidence. Comments and inactive code can match. Configuration is never
  evaluated. Lockfile-only transitive dependencies are not reported as overlap.
- Node and Deno entrypoints, nginx config, and Apache config can provide
  medium-confidence local evidence. A Markdown MIME string does not prove a rule's
  scope, effective precedence, or deployment.
- A recorded Node or Deno adapter is high-confidence evidence about the last local
  build, not the deployed service.

The initial overlap registry covers `@astrojs/sitemap`, `@astrojs/starlight`,
`astro-robots-txt`, and `astro-llms-txt`. The sitemap integration can coexist:
Astro-AEO already detects explicit registration. Advice asks users to choose
ownership only where appropriate; installing a package alone never causes a
`conflicting` result. Other packages are not inferred from their names.

Evidence reads are bounded and do not follow symlinked files or directories.
The doctor does not scan arbitrary application files or execute consumer code.

## Build output and ownership

When an ownership ledger is available, doctor checks its output identity against
`--dist` and its ownership digest against deployment facts. Mismatched evidence is
`conflicting`; artifact conclusions are withheld until the correct output is
selected or rebuilt. Existing writer decisions determine ownership conflicts,
including skipped artifact groups. Preserved external ownership is not itself a
collision. Doctor never creates a new competing output or changes arbitration.

Emitted artifacts are checked against recorded etags. Missing or unsafe files are
`missing`; altered bytes are `conflicting`. Matching bytes remain `unverified`
because no local inspection proves those bytes were deployed.

## Render Markdown MIME repair

Render distinguishes root files from nested paths, so both `/*.md` and `/**/*.md`
must set `Content-Type: text/markdown; charset=utf-8`. See the
[Render header matching documentation](https://render.com/docs/static-site-headers).

Doctor and `astro-aeo fix` use the same YAML editor. A root-only rule is incomplete.
Fix repairs or adds both rules in one transaction with one backup of the original
file. Comments, anchors, service selection, and line endings are preserved. A
duplicate Content-Type rule for either path refuses the entire change. A second
run with both rules correct preserves the original bytes and creates no backup.

These checks and examples are local evidence. They are not deployed-provider
verification.
