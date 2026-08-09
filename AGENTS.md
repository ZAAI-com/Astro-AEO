# AGENTS.md

Guide for coding agents working on this repository. Use `README.md` for the user-facing feature
and configuration reference. Keep this file focused on architecture, invariants, and development
workflow.

## What this is

`astro-aeo` is an Astro integration, validator CLI, and set of JSON-LD components. It ships as
plain ESM with no package build step.

- At build time it turns eligible rendered pages into `.md` companions and can emit `llms.txt`,
  `llms-full.txt`, `robots.txt`, `/.well-known/domain-profile.json`, a URL map, and a sitemap
  alias. When a build contains server output or an on-demand page, middleware owns the corpus
  paths so request-time pages can be included.
- At request time its pre-middleware serves eligible `.md` companions, content negotiation, and
  enabled text artifacts. Static sites still receive ordinary files for their build-time output.

## Architecture

- `src/index.js` is the integration entry. It retains resolved configuration and site facts and
  wires exactly these hooks: `astro:config:setup`, `astro:config:done`,
  `astro:routes:resolved`, and `astro:build:done`.
- `src/config.js` resolves defaults, validates nested keys through `CONFIG_SHAPE`, and resolves
  site metadata. `src/lib/config-migrate.js` owns all 1.0 to 1.1 moves through `LEGACY_MOVES`,
  including warnings, conflicts, the migration printer, and migration-doc checks.
- `src/hooks/build-done.js` orchestrates collection and generators. `src/build/artifacts.js` is
  the single output writer and arbitrates collisions with other generators, project routes,
  `public/`, and existing destinations. Keep its policies and user-visible messages stable.
- Catalog modules are preflighted in `astro:config:done`, before Vite creates the server graph.
  A catalog that cannot load is omitted, warns, and records a diagnostic instead of breaking the
  consumer build or server startup. Catalogs enumerate data-generated routes that Astro cannot
  list; the integration never crawls the site to discover them.
- `src/build/collect.js` normalizes rendered build output after concrete routes and catalog
  descriptors are merged.
  `src/build/diagnostics.js` writes the versioned, sanitized
  `.astro/aeo-cache/diagnostics-v1.json` manifest without copying source or rendered content.
- `src/core/` contains source-agnostic logic shared by build and runtime. `page-model.js` performs
  the single normalization step and returns either an `AeoPage` record or a named skip reason.
  `extract/`, `page-meta.js`, `match.js`, and `render/` own extraction, metadata, matching,
  and output strings.
- `src/virtual/` transports the runtime snapshot because middleware cannot close over integration
  state. It also creates lazy catalog loaders and a `?raw` registry that carries standalone
  Markdown source into server bundles after stripping only leading frontmatter.
- `src/runtime/middleware.js` and `src/runtime/serve.js` implement request-time artifacts. A
  direct `.md` request rewrites into the underlying project route, so application middleware and
  authentication apply as they do to HTML. Preserve the project's status, redirects, cookies,
  and relevant representation headers, and never fall through after a direct rewrite.
- Live corpora render known pages serially through trusted in-process rewrites with caller
  credentials removed. They are anonymous fan-out requests, bounded by `corpus.runtime.maxPages`,
  and require Astro 6.3 or newer for disposable per-page request state. Astro 5 and 6.0 through
  6.2 must fail closed with `503`; build corpora and direct authenticated `.md` requests remain
  supported.
- `components/AeoPage.astro` lets a page provide exact authored Markdown and metadata from
  `defineAeoPage`. Its internal marker is emitted only during collection. Marker removal is an
  unconditional pass independent of generators at build time. Collected responses are also
  stripped before conversion or forwarding, including errors and opted-out pages.
- `components/` holds `AeoPage` and the six JSON-LD components. `cli/validate.js` and
  `cli/report.js`, entered through `bin/astro-aeo.js`, implement the validator.

### Runtime invariants

- `src/core/` and `src/runtime/` may not import `node:` modules or reach modules that do. The
  boundary test enforces this because these modules enter consumer SSR and edge bundles. Keep
  runtime imports lightweight.
- Astro blanks request headers and query strings for prerendered routes. Content negotiation is
  therefore on-demand only; direct `.md` requests are handled separately and work on static
  projects.
- The middleware entrypoint stays the bare specifier `astro-aeo/middleware`, registered with
  `order: 'pre'`. Vite resolves it. `addMiddleware` itself must not introduce an adapter
  requirement.
- Runtime configuration must remain serializable. Function options apply during builds but cannot
  cross the virtual-module boundary; keep warnings and fallbacks explicit.

## Package conventions

- Use plain ESM JavaScript with `// @ts-check` and JSDoc. The published folders are `src`,
  `components`, `bin`, `cli`, and `schema`, so every shipped source file must run as published and
  remain installable from a git dependency.
- Public declarations are hand-written in exactly five files: `src/index.d.ts`,
  `components/index.d.ts`, `src/page.d.ts`, `src/extract.d.ts`, and
  `src/runtime/middleware.d.ts`. Update declarations and consumer type tests with their code.
- There are three runtime dependencies: `@astrojs/sitemap`, `turndown`, and `linkedom` via
  `linkedom/worker`. Do not add another without a comparably strong reason.
- House style forbids em dashes. Use a colon, comma, or parentheses.
- Contributor tooling uses pnpm 11 and requires Node 22.13 or newer. The published package must
  continue to run on Node 20.19.5 or newer and Astro 5 or newer. CI installs dependencies with a
  newer Node before switching down for the Node 20 compatibility checks.

## Tests and compatibility

- Vitest tests are colocated as `*.test.js`; add or update tests with every behavior change.
  `pnpm test` runs unit, CLI, and static-build tests in the default configuration.
- A test selected by the default configuration that shells out to `astro build` must use
  `*.e2e.test.js`. The Node compatibility job excludes that suffix because its installed Astro 7
  cannot run on Node 20. This naming rule does not apply to the separately selected server and
  adapter suites.
- `*.dev.test.js` belongs to `pnpm run test:dev`; `*.ssr.test.js` belongs to
  `pnpm run test:ssr`. Adapter tests live under `test/adapters/` and use their dedicated build and
  runtime configs. Any build-spawning test must own its fixture root because files run in parallel.
- `fixtures/config-compat` proves legacy and canonical spelling parity. Keep both configs aligned.
  `fixtures/golden-1.0/expected.json` is frozen output from the actual 1.0 release; do not refresh
  it from the current implementation. Its test protects the artifact set across Astro majors and
  byte identity on the Astro major that produced it.
- `pnpm run typecheck` checks source JSDoc with the current compiler. `pnpm run test:types` checks
  the published exports and declarations through `fixtures/types-consumer` on TypeScript 5.5.
- `pnpm run test:adapters` builds Node, Cloudflare, Deno, Vercel, and Netlify fixtures and runs the
  local request contract for Node, workerd, and Deno. Vercel and Netlify are build and artifact
  checks only.

## Development commands

```bash
pnpm install
pnpm test
pnpm run test:watch
pnpm run test:dev
pnpm run test:ssr
pnpm run test:adapters
pnpm run typecheck
pnpm run test:types
pnpm run schema:check
pnpm run demo:dev
pnpm run demo:build
pnpm run demo:validate
pnpm run release:check
```

`pnpm run release:check -- --quick` runs schema and migration-doc freshness, Changeset coverage,
release metadata, both type checks, the default suite, and packed-tarball inspection. The full
gate additionally runs dev, SSR, adapter, package-install, bundle-baseline, and performance checks.

## Configuration, schema, and releases

- When adding or changing configuration, keep `src/config.js`, `CONFIG_SHAPE`,
  `scripts/schema-definition.mjs`, the applicable declarations, README configuration docs,
  CHANGELOG, tests, and `fixtures/types-consumer/consumer.ts` aligned. Run
  `pnpm run schema:generate`; never hand-edit `schema/astro-aeo.schema.json`.
- Keep `ResolvedAstroAeoConfig` and its consumer reads current. Both typecheck projects use
  `skipLibCheck`, so assertions placed only inside a declaration file are not drift guards.
- For a rename, add it to `LEGACY_MOVES`; generators read canonical paths only.
  `ResolvedAeoConfig` is frozen at the 1.0 shape and must not grow.
- Published behavior, configuration, types, generated output, or runtime compatibility changes
  require `pnpm changeset`. Documentation, tests, and internal maintenance may use an empty
  Changeset only when CI explicitly requires one. Versioning consumes Changesets before the
  numeric release tag is created.
- Before handoff, run checks proportional to the change, then use the quick release check for a
  broad local gate. The tag workflow adds strict tag, clean-worktree, adapter, package, and
  performance gates before npm publication.
