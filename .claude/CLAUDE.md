# CLAUDE.md

Guide for AI agents working on this repository. For the user-facing feature and configuration
reference, see [`README.md`](../README.md); this file focuses on architecture, conventions, and
the dev/test workflow so docs and code do not drift.

## What this is

`astro-aeo` is an Astro integration (plus a validator CLI and a set of JSON-LD components) that
generates machine-readable companions for a site at build time: `.md` copies of every page,
`llms.txt` / `llms-full.txt`, `robots.txt`, `/.well-known/domain-profile.json`, and an optional
URL map. It ships as plain ESM with no build step.

## Architecture

The build pipeline, in the order data flows:

- `src/index.js`: integration entry. Wires the Astro hooks and holds resolved config plus site
  facts (`siteUrl`, `base`, `trailingSlash`, `buildFormat`, `projectRoot`, `routeEntrypoints`).
  Hooks used: `astro:config:setup`, `astro:config:done`, `astro:routes:resolved`,
  `astro:server:setup`, `astro:build:done`.
- `src/config.js`: `resolveConfig` lifts any 1.0 keys onto their canonical paths, fills every
  default, and warns on unknown keys at any depth (`CONFIG_SHAPE`, where `PASSTHROUGH` marks a
  subtree forwarded to another tool). `resolveSiteMeta` resolves the site name/description via the
  fallback chain `site.*` -> `site.profile.*` -> home `<title>` -> hostname.
- `src/lib/config-migrate.js`: the 1.0 -> 1.1 rename. `LEGACY_MOVES` is the single source of truth
  for where each old key went, and it drives the deprecation warnings, the conflict errors, the
  `AEO_PRINT_MIGRATION` printer, and the README table, so those four cannot drift. A 1.0 key and
  its canonical replacement set to different values throws `AeoConfigError` (`src/lib/errors.js`);
  set to equal values, canonical wins with one warning.
- `src/hooks/build-done.js`: `onBuildDone` orchestrates every generator on `astro:build:done`.
- `src/runtime/middleware.js`: the `addMiddleware` entrypoint, registered with `order: 'pre'` so
  it is outermost and `next()` yields the fully rendered response. It serves `.md` companions,
  `Accept` negotiation, and (in dev, where no build output exists) the text artifacts. There is no
  longer a separate dev implementation.
- `src/core/`: pure, source-agnostic logic shared by the build and the dev server. Nothing here
  reads the filesystem, so the same functions run over build output and a live response. This is
  enforced by `src/core/boundary.test.js`, which fails on a `node:` import or a reach into any
  directory that has one. It matters because these modules are destined for a consumer's SSR
  bundle, where a violation fails **their** build, not ours.
  - `page-model.js`: the `AeoPage` / `BuildPage` records, the URL helpers, and `buildPage()`, the
    single normalize step. It returns either a page or a named skip reason, never silence.
  - `html-document.js`: the only module that knows the DOM implementation (`linkedom/worker`).
  - `extract/`: selector-based content extraction, cleanup, `keepSelectors`, URL resolution, and
    extraction diagnostics.
  - `match.js`: segment-aware glob / RegExp / predicate matching used by include/exclude and
    `corpus.index.sections`.
  - `page-meta.js`: parses title, description, and AEO meta tags out of rendered HTML.
  - `html-to-md.js`: Turndown wiring over the extraction pipeline.
  - `render/`: the string builders. `renderMarkdownDocument` is the single definition of a `.md`
    body; `renderLlmsTxt` / `renderLlmsFullTxt` likewise. Build and dev both call these, which is
    what keeps them from drifting as they previously did.
- `src/lib/`: shared helpers.
  - `git-mtime.js`: last-modified dates from git history (falls back behind
    `article:modified_time`).
  - `serialize-jsonld.js`: XSS-safe JSON-LD serialization used by the components.
- `src/virtual/`: the runtime's configuration transport. `plugin.js` is a Vite plugin serving the
  virtual module `astro-aeo:runtime-config`; `serialize.js` emits the resolved config as source.
  A module registered with `addMiddleware` is a separate module and cannot close over the
  integration's state, and `astro:env` only carries scalars, so this is how config reaches request
  time. `load()` is called on first import, after `astro:config:done`, which is why the snapshot is
  read through a callback: the site facts do not exist when the plugin is registered.
- `src/runtime/`: modules destined for the consumer's SSR bundle. Same no-`node:` rule as
  `src/core/`, and additionally no heavy imports: what lands here is bundled into **their** build.
- `src/sources/dist-html.js`: the build's HTML source, reading rendered pages back out of the
  build output. The filesystem half of the pipeline, kept out of `src/core/` on purpose.
- `src/build/collect.js`: runs `buildPage` over the build's pages and adds what only a build
  knows (the HTML path, the `.md` path, and the git-history fallback for `lastModified`).
- `src/build/artifacts.js`: the single writer for build output. Generators declare an `Artifact`
  (path, owner, route, contents or `copyFrom`, and a collision policy) rather than calling
  `writeFileSync`. It detects four collision sources: another astro-aeo owner, a route the project
  defines, a file in `public/`, and an existing file at the destination. The three historical
  policies (`overwrite`, `warn-overwrite`, `skip`) and their exact messages are preserved, because
  those messages are asserted by tests and read by users.
- `src/generators/`: one module per output, each exposes an `emit*` function.
  `dotmd.js`, `llms-txt.js` (both `llms.txt` and `llms-full.txt`), `robots-txt.js`,
  `domain-profile.js`, `url-map.js`, `sitemap-alias.js`, and the late
  `sitemap-finalize.js` orchestrator.
- `components/`: the six JSON-LD `.astro` components (`FaqJsonLd`, `HowToJsonLd`,
  `BreadcrumbJsonLd`, `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`) plus `index.js`
  and hand-written `index.d.ts`.
- `cli/validate.js` + `cli/report.js`, entered through `bin/astro-aeo.js`: the
  `astro-aeo validate` command that checks a built `dist` for common AEO mistakes.

### Verified Astro behaviour

Measured against Astro 7 in this repo, not inferred. Re-verify before changing the transport.

- A middleware entrypoint registered as a **bare specifier** (`astro-aeo/middleware`) resolves.
  Astro emits it verbatim into a generated import, so **Vite** resolves it, not Node. It works from
  a fixture using the `link:` self-link, in both build and dev.
- App middleware **does** run for a path that matches no route, and a `Response` it returns without
  calling `next()` arrives with **its own status**. `handler.js` seeds `state.status = 404` before
  the chain, but that only seeds the page render. A returned 200 is a 200 over the wire.
- `next('/some-page')` from an unmatched path rewrites into the real route and returns its rendered
  response, so a `.md` request re-enters the project's own middleware and its auth applies.
- Middleware runs during the static prerender pass for every page, with `context.isPrerendered`
  true. In `astro dev` static routes also report `isPrerendered: true`, so a gate meant to skip
  prerendering must test `command === 'build' && isPrerendered`, never `isPrerendered` alone.
- Astro **blanks request headers and the query string** for a prerendered route
  (`core/request.js`), on purpose, so code reading them cannot work in dev and then fail once the
  page is a static file. Content negotiation therefore only ever applies to on-demand routes. A
  direct `.md` request is unaffected: it matches no route, so it is handled on the synthetic
  `/404` route, which is not prerendered and does have headers.
- A `.md` request must never fall through to `next()` once `context.rewrite()` has been called:
  `next()` then resolves to the underlying page's HTML, which would serve an excluded or
  `no-dotmd` page's content at the `.md` URL with a 200.
- `addMiddleware` does **not** require an adapter, unlike `injectRoute({ prerender: false })`,
  which flips `buildOutput` to `server` and fails a static project with `NoAdapterInstalled`.

## Conventions

- Plain ESM JavaScript with `// @ts-check` and JSDoc types. There is **no build step**: the
  `src`, `components`, `bin`, and `cli` folders are published as-is, so the package must stay
  installable directly as a git dependency.
- Types are **hand-written** in `src/index.d.ts` and `components/index.d.ts` (not generated).
  Update them in the same change as the code they describe.
- Keep runtime dependencies minimal. There are three: `@astrojs/sitemap` (the official
  integration, rather than re-implementing the sitemap spec), `turndown` (HTML to Markdown), and
  `linkedom` (imported as `linkedom/worker`, a single pre-bundled ESM file that runs unchanged in
  Node and on edge runtimes). Extraction needs a real DOM for selectors, cleanup, marker removal,
  and URL resolution, and one parser shared by every stage beats a regular expression per stage.
  Do not add a fourth without a comparably strong reason.
- House style: no em dashes anywhere (use a colon, comma, or parentheses).

## Tests

- Vitest, with tests colocated next to the source they cover as `*.test.js`. Add or adjust a
  test with every behavior change.
- `pnpm test` runs the unit, CLI, and build e2e tests. The build e2e spawns `astro build`, so
  the config uses long (120s) timeouts. Vitest runs test **files in parallel**, so an e2e that
  spawns a build must own its fixture root: two builds against one root clobber each other's
  output. `fixtures/config-compat` exists for exactly this reason, rather than reusing the demo.
- `src/config-compat.e2e.test.js` builds `fixtures/config-compat` twice, once from
  `astro.legacy.config.mjs` and once from `astro.canonical.config.mjs`, and diffs the two outputs
  byte for byte. That diff is the 1.0 compatibility guarantee. Keep the two configs in lockstep;
  `AEO_PRINT_MIGRATION=1 astro build` prints the canonical spelling of a 1.0 config.
- `pnpm run test:dev` runs the opt-in dev-server e2e (`*.dev.test.js`), which spawns
  `astro dev`. It is excluded from the default run.
- `pnpm run typecheck` runs `tsc --noEmit` against the JSDoc types, using the repo's own
  (newest) TypeScript.
- `pnpm run test:types` typechecks `fixtures/types-consumer/` against the **oldest** supported
  TypeScript (the `typescript-floor` devDependency alias, currently 5.5). It imports the package
  through its real `exports` map, via the `astro-aeo: link:.` self-link, so it covers the
  hand-written `.d.ts` files the way a downstream project sees them: `pnpm run typecheck` never
  would, since it only ever sees them through the current compiler. Extend `consumer.ts` when
  adding or renaming a public type, and keep its `@ts-expect-error` lines: they are the
  assertions that closed unions and unknown-option rejection still hold.

## Dev commands

```bash
pnpm install
pnpm test              # unit + CLI + build e2e (Vitest)
pnpm run test:watch    # Vitest in watch mode
pnpm run test:dev      # dev-server e2e (spawns astro dev)
pnpm run typecheck     # tsc --noEmit against JSDoc types (newest TypeScript)
pnpm run test:types    # consumer .d.ts check on the oldest supported TypeScript
pnpm run demo:dev      # run the demo site in fixtures/demo
pnpm run demo:build    # build the demo site
pnpm run demo:validate # run the validator CLI on the demo build
```

## When adding a config option

Keep these six in sync so behavior, types, and docs match:

1. `resolveConfig` defaults in `src/config.js` (and add the key to `CONFIG_SHAPE`, at its real
   depth, or it will warn as a typo).
2. The types in `src/index.d.ts` (and `components/index.d.ts` for component props).
3. The Configuration block in `README.md`.
4. A note in `CHANGELOG.md`.
5. `fixtures/types-consumer/consumer.ts`, so the option is exercised from a consumer's side.
6. `ResolvedAstroAeoConfig` in `src/index.d.ts`, plus a read of the new field in `consumer.ts`.
   The resolved type is hand-written, and both tsconfigs set `skipLibCheck` (Astro's own
   declarations do not compile without it), so a type assertion written inside `src/index.d.ts` is
   never evaluated. `consumer.ts` is the only place a drift guard actually runs.

When renaming an option, add a row to `LEGACY_MOVES` rather than reading the old key anywhere:
generators read canonical paths only. `ResolvedAeoConfig` is frozen at the 1.0 shape and must not
grow.

## CI and compatibility

`.github/workflows/W1-Test.yml` runs the suite against Astro 5, 6, and 7 and smoke-tests the
published artifact on Node 20, 22, and 24. Keep the code compatible with Node >=20.19.5 and Astro
>=5.
