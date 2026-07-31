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
- `src/hooks/server-setup.js`: dev-server middleware that serves `robots.txt`,
  `domain-profile.json`, and `.md` companions live, and builds a static-route `llms.txt`, during
  `astro dev`.
- `src/lib/`: shared helpers.
  - `collect.js`: turns raw build pages into normalized `AeoPage` records (path, url, title,
    description, last-modified).
  - `match.js`: segment-aware glob / RegExp / predicate matching used by include/exclude and
    `llmsTxt.sections`.
  - `html-to-md.js`: HTML `<main>` to Markdown via Turndown.
  - `git-mtime.js`: last-modified dates from git history (falls back behind
    `article:modified_time`).
  - `page-meta.js`: parses title, description, and AEO meta tags out of rendered HTML.
  - `serialize-jsonld.js`: XSS-safe JSON-LD serialization used by the components.
- `src/generators/`: one module per output, each exposes an `emit*` function.
  `dotmd.js`, `llms-txt.js` (both `llms.txt` and `llms-full.txt`), `robots-txt.js`,
  `domain-profile.js`, `url-map.js`, `sitemap-alias.js`, and the late
  `sitemap-finalize.js` orchestrator.
- `components/`: the six JSON-LD `.astro` components (`FaqJsonLd`, `HowToJsonLd`,
  `BreadcrumbJsonLd`, `OrganizationJsonLd`, `SpeakableJsonLd`, `ArticleJsonLd`) plus `index.js`
  and hand-written `index.d.ts`.
- `cli/validate.js` + `cli/report.js`, entered through `bin/astro-aeo.js`: the
  `astro-aeo validate` command that checks a built `dist` for common AEO mistakes.

## Conventions

- Plain ESM JavaScript with `// @ts-check` and JSDoc types. There is **no build step**: the
  `src`, `components`, `bin`, and `cli` folders are published as-is, so the package must stay
  installable directly as a git dependency.
- Types are **hand-written** in `src/index.d.ts` and `components/index.d.ts` (not generated).
  Update them in the same change as the code they describe.
- Keep runtime dependencies minimal. `turndown` is the only one today; do not add another
  without a strong reason.
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
