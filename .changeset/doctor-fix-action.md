---
'astro-aeo': minor
---

Add `astro-aeo doctor [projectDir]`, which reports how a project is set up to deploy as `configured`,
`missing`, `conflicting` or `unverified`. Local files never earn `configured`: `--url <page>` probes the
deployment anonymously with the same Accept contract the middleware and edge handlers are tested
against, and what the deployment does replaces what the files suggest.

Add `astro-aeo fix [projectDir]`, which makes a static host serve `.md` companions as
`text/markdown; charset=utf-8` by editing `public/_headers` (Cloudflare Pages, Netlify), `vercel.json`
or `render.yaml`, keeping everything else in the file. It is a dry run unless `--write`, backs the
original up under `.astro/aeo-backups/`, is a no-op the second time, and refuses ambiguous providers,
malformed documents, competing rules, symbolic links and paths outside the project. nginx, Apache, Node,
Workers and Deno get a printed snippet. `yaml` becomes a runtime dependency for the `render.yaml` edit
alone and is loaded on demand.

Add a composite GitHub Action at the repository root that audits a build or a URL, uploads SARIF to code
scanning, and reports the exit status after the upload.

Fix a build failure on multilingual sites: the inferred site-wide `WebSite` entity took `inLanguage`
from each page, so two Astro i18n locales conflicted in the merged site graph
(`schema.scalar-conflict`). The shared entity now carries no language on a multilingual site; every
`WebPage` keeps its own, and single-language output is unchanged.
