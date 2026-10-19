# Standards and compatibility

Reviewed against primary documentation on 2026-10-04. Output improves inspectability, not a
promise of indexing, rankings, citations, crawler access, or rich-result eligibility.

## Format status

| Surface | Status and scope |
| --- | --- |
| HTTP negotiation, HEAD, representation validators | Standard HTTP semantics. Markdown still inherits application authentication, redirects and cookies. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html). |
| robots.txt | Standard crawler exclusion syntax, not authentication or proof of crawler identity. AEO comments and content-signal extensions are not part of the standard. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html). |
| Sitemap XML | Discovery format, not an indexing guarantee. [Sitemap protocol](https://www.sitemaps.org/protocol.html). |
| JSON-LD and Schema.org | JSON-LD syntax and a separate vocabulary. Google feature policies are additional requirements. [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/), [Schema.org](https://schema.org/docs/schemas.html). |
| llms.txt and Markdown companions | Community proposal, not an IETF/W3C standard. The upstream proposal now labels itself v2; this release retains the package's established Markdown index and companion topology rather than claiming exhaustive v2 compliance. [Proposal](https://llmstxt.org/). |
| Domain profile, graph map, corpus manifests, analytics and RAG | Versioned Astro-AEO contracts. They are not universal discovery, privacy, or RAG interoperability standards. See the exported schemas. |

## Complementary tools

This comparison describes documented scope, not an exhaustive absence-of-feature claim. No
third-party benchmark or hosted verification was performed.

| Tool or approach | Documented focus | Astro-AEO relationship |
| --- | --- | --- |
| [astro-seo](https://github.com/jonasmerlin/astro-seo) | A component for authored metadata, canonical links, social cards and language alternates. | Keep authored metadata authoritative. AEO fills only missing supported facts and adds Markdown, corpus and audit workflows. |
| [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) | Sitemap generation for build-known routes; additional URLs can be supplied. | AEO reuses it rather than replacing its protocol. Catalogs supply externally inventoried pages; live discovery is explicit and bounded. |
| Hand-authored Markdown and llms.txt | Exact author control and ordinary static hosting. | Supported through source markers and ownership arbitration. AEO adds managed output, runtime authentication parity and evidence, with corresponding server and package costs. |

## Supported surfaces

The published floors remain Node **20.19.5** and Astro **5**. Contributor tooling requires
Node **22.13** and pnpm **11**; the installed Astro version may require a higher Node version.
A real Node 20 server must use a compatible Astro/adapter pair, not Astro 7.

| Matrix | Contract |
| --- | --- |
| Astro 5.18.2 + Node adapter 9.5.5 + Node 20.19.5 | Direct authenticated Markdown and build output supported; live inventory corpora fail closed with 503. |
| Astro 6.2.2 + Node adapter 10.0.6 + Node 22.13.1 | Same live-corpus restriction. |
| Astro 6.3.0 + Node adapter 10.1.0 + Node 22.13.1 | Disposable rewrite state enables serial anonymous live corpora for rewriteable pages. |
| Astro 7.2.0 + Node adapter 11.1.0, and Astro 7.3.1 + Node adapter 11.1.5 + Node 24 | Pinned request-state boundaries in CI. |
| Astro 5, 6, 7 | Default output and declaration consumers in CI; Node 20.19.5, 22, 24 exercise plain public imports and non-build unit tests. |
| Node, workerd, Deno | Local request contracts. Deno is pinned exactly in `.tool-versions`; a different installed version fails the contract. |
| Vercel and Netlify | Local emitted-handler contracts and build/artifact checks, not deployed certification. |
| Git and tarball dependencies | Plain ESM source, Astro builds, optional-peer isolation, TypeScript 5.5 and JS/JSDoc consumers. Git evidence names the tested committed revision. |

A hybrid inventory containing a prerendered page that Astro cannot rewrite returns 503 rather
than an incomplete corpus. The build-time companion remains available. This is an in-process
rewrite limitation, not permission to fall back to production loopback or caller credentials.

The local 6.x evidence uses Node 22.14.0, not the exact CI 22.13.1 pin. CI matrices describe
required coverage, not a claim that hosted jobs ran in this workspace. Optional peers remain
optional. Analytics does not install provider handlers; edge observation requires explicit injection.

## Dependency review

`renovate.json` groups Astro/adapter changes for compatibility review and manages npm, GitHub
Actions and the shared Deno pin. Automerge is disabled. Activating the Renovate app in the
repository remains an owner action, not something this configuration proves has happened.
[Renovate asdf manager](https://docs.renovatebot.com/modules/manager/asdf/) supports `.tool-versions`;
[setup-deno](https://github.com/denoland/setup-deno#version-from-file) reads the same file.

No new mandatory runtime dependency was introduced by this release. Core/runtime/edge import
closures stay Node-free; Node JSONL sinks enter only supported generated server modules.
