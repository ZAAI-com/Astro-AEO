# Google structured-data profile scope

Profiles were checked against Google's official documentation on **September 30, 2026**. They are
committed, dependency-free field checks, never downloaded at runtime. Schema.org graph validation
continues separately and is unchanged by default.

Use `astro-aeo audit dist --schema-target google` or the same flag with a live URL. Schema
components can opt in with `eligibility="google"`. Despite its name, `eligibility` only selects checks.
Findings do not alter or suppress output. Required fields and unsupported required shapes are
warnings; recommendations and unsupported profiles are information. Warnings use the existing
readiness deductions and severity gates. Editorial advice is always score-neutral.

| Profile | Scope | Official reference |
| --- | --- | --- |
| Article, BlogPosting, NewsArticle | Recommended headline, author, dates, image; no universal required fields | [Article](https://developers.google.com/search/docs/appearance/structured-data/article) |
| Product | Name and an offer, aggregate rating, or review; offer price alternatives and nested rating fields | [Product snippets](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) |
| SoftwareApplication | Name, offer price, and rating/review; documented application categories and operating system recommendations | [Software app](https://developers.google.com/search/docs/appearance/structured-data/software-app) |
| Review | Named author, rating, supported reviewed type and its name; nested-parent alternative | [Review snippet](https://developers.google.com/search/docs/appearance/structured-data/review-snippet) |
| Dataset | Name and description of 50 to 5000 characters; descriptive recommendations | [Dataset](https://developers.google.com/search/docs/appearance/structured-data/dataset) |
| ProfilePage | Person/Organization main entity with name or alternateName; dates and entity recommendations | [Profile page](https://developers.google.com/search/docs/appearance/structured-data/profile-page) |
| LocalBusiness | Name and PostalAddress; contact, location, hours, department and review recommendations | [Local business](https://developers.google.com/search/docs/appearance/structured-data/local-business) |

## Schema.org validity is separate

- [FAQPage](https://schema.org/FAQPage) remains a Schema.org type. Google's
  [documentation changelog](https://developers.google.com/search/updates) records the end of FAQ
  rich results on **May 7, 2026**, and removal of its feature documentation on **June 15, 2026**.
  Historical FAQ fields are not enforced as current Google requirements.
- [TechArticle](https://schema.org/TechArticle) remains a Schema.org type. Google's Article guide
  names Article, NewsArticle, and BlogPosting, not TechArticle. This does not prove that Google
  ignores TechArticle; this package does not invent a documented profile for it.
- Service, generic ItemList, HowTo, BreadcrumbList, Organization, and Speakable/WebPage have no
  Google profile implemented by this checker. This describes package coverage, not a claim that
  Google has no feature documentation for every such type.

Explicit component requests for unsupported types produce one informational explanation. Whole-site
audits skip those types, while still checking supported entities nested within them. Both FAQPage
and TechArticle output is retained unchanged.

## Boundaries

- Product checks cover product snippets, not merchant listings, shopping policies, or feeds.
- Review checks cover the documented reviewed types. Self-serving Organization/LocalBusiness
  reviews do not qualify; field checks cannot establish independence and only remind the caller.
- Final audit JSON-LD can resolve `@id` references across scripts on the same page. A component
  sees only its own entity, so sibling-script references can produce provisional missing-shape
  findings there. Audit the rendered page to evaluate its complete graph.
- Complementary definitions of one `@id` are combined without changing the input. Conflicting
  checked fields retain the first value and receive required-field warnings or recommendation advice.
  Findings identify their entity through the existing report evidence field.
- An entity used only as a Review's `itemReviewed` is checked for the supported reviewed type and
  name, not unrelated standalone requirements. Additional uses such as `mainEntity`, standalone
  entities, and explicit component checks retain their full profiles.
- A supplied Product `offers.price` takes precedence over `priceSpecification.price`, including
  its currency source. Dataset licenses accept documented URL and CreativeWork representations.
- No external references are fetched. Unknown references cannot substitute for observed required
  fields. The checker does not crawl author or offer URLs.
- Shape checks are intentionally bounded. They do not implement all Schema.org inference,
  provider-specific business subtypes, editorial policies, or every conditional recommendation.
- No field check certifies visible-content consistency, eligibility, indexing, rich results,
  search ranking, or AI citations. Google may change these profiles after the verification date.

Stable codes are `google-schema-required`, `google-schema-recommended`, and
`google-schema-unsupported`. Messages identify fields and documentation without copying page prose.
