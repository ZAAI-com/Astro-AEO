# Contributing to Astro-AEO

Thank you for helping improve Astro-AEO. The package is published as plain ESM without a build
step, so changes must work directly from a git dependency as well as from the npm tarball.

## Development setup

Astro-AEO requires Node 20.19.5 or newer and pnpm 11.

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run test:types
```

Use `pnpm run test:dev` for the development-server contract and `pnpm run test:ssr` for the Node
adapter contract. Adapter matrix tests are split into `test:adapters:build` and
`test:adapters:runtime` so provider artifacts can be verified even when their local runtime is not
installed.

Tests are colocated with source files as `*.test.js`. Build tests must own separate fixture roots,
because Vitest runs files concurrently and two Astro builds cannot safely share an output folder.

## Code and compatibility

- Use plain ESM JavaScript with `// @ts-check` and JSDoc.
- Keep runtime and core modules free of `node:` imports.
- Update public declarations in the same change as their implementation.
- Preserve the 1.0 configuration aliases throughout 1.x.
- Add or update a golden fixture for generated-output changes.
- Do not add a runtime dependency without explaining why the existing browser APIs and three
  dependencies cannot provide the capability.

When adding a configuration option, update its default and validation, public and resolved types,
README example, changelog, consumer type fixture, and the committed JSON schema.

## Changesets and pull requests

Run `pnpm changeset` for every user-visible package change. The summary should explain the outcome
for users rather than list files. Before requesting review, run:

```bash
pnpm run release:check
```

The complete release check includes type tests, core and integration tests, adapter checks, schema
freshness, packed-tarball installation, and performance safety ceilings. A performance regression
over 10 percent needs an explanatory changeset even when it remains below the absolute ceiling.

Please keep pull requests focused and document deliberate output changes. Security issues should
not be opened as public issues; follow [SECURITY.md](SECURITY.md) instead.
