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
  Hooks used: `astro:config:done`, `astro:routes:resolved`, `astro:server:setup`,
  `astro:build:done`.
- `src/config.js`: `resolveConfig` fills every default and warns on unknown top-level keys
  (`KNOWN_KEYS`) and the deprecated `dotmd.dotmdMetadata` alias. `resolveSiteMeta` resolves the
  site name/description via the fallback chain `site.*` -> `domainProfile.*` -> home `<title>`
  -> hostname.
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
  `domain-profile.js`, `url-map.js`.
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
  the config uses long (120s) timeouts.
- `pnpm run test:dev` runs the opt-in dev-server e2e (`*.dev.test.js`), which spawns
  `astro dev`. It is excluded from the default run.
- `pnpm run typecheck` runs `tsc --noEmit` against the JSDoc types.

## Dev commands

```bash
pnpm install
pnpm test              # unit + CLI + build e2e (Vitest)
pnpm run test:watch    # Vitest in watch mode
pnpm run test:dev      # dev-server e2e (spawns astro dev)
pnpm run typecheck     # tsc --noEmit against JSDoc types
pnpm run demo:dev      # run the demo site in fixtures/demo
pnpm run demo:build    # build the demo site
pnpm run demo:validate # run the validator CLI on the demo build
```

## When adding a config option

Keep these four in sync so behavior, types, and docs match:

1. `resolveConfig` defaults in `src/config.js` (and add any new top-level key to `KNOWN_KEYS`).
2. The types in `src/index.d.ts` (and `components/index.d.ts` for component props).
3. The Configuration block in `README.md`.
4. A note in `CHANGELOG.md`.

## CI and compatibility

`.github/workflows/W1-Test.yml` runs the suite against Astro 5, 6, and 7 and smoke-tests the
published artifact on Node 20, 22, and 24. Keep the code compatible with Node >=20.3 and Astro
>=5.
