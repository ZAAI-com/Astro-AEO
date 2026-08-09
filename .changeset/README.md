# Changesets

Every pull request that changes published behavior, configuration, types, generated output, or
runtime compatibility must include a changeset:

```bash
pnpm changeset
```

Choose `astro-aeo`, select the SemVer impact, and describe the user-visible result. Documentation,
tests, and internal maintenance that cannot affect the package may use an empty changeset when CI
explicitly requires one:

```bash
pnpm changeset --empty
```

Maintainers run `pnpm changeset version` on a release branch, review the resulting package version
and changelog, and create the matching numeric tag. The release workflow validates that the tag,
package version, and changelog agree before publishing.
