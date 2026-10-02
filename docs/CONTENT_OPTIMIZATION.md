# Content optimization

Run `astro-aeo audit dist --heuristics` or `astro-aeo audit https://example.com/ --heuristics`
to request editorial advice. This is deterministic guidance, not an AI rewrite or a ranking model.
Every finding is informational, has a documentation link, adds zero score deductions, and cannot
fail a severity gate. Ordinary audits are unchanged. No article passages are copied into findings.

## Answer-first sections

Use descriptive headings and answer the question directly before adding context. A question heading
ending in `?` or `？` needs prose, a list, or a table before the next heading at the same or higher level.
Nested explanatory headings do not themselves count as an answer.

English:

```markdown
## How do I publish the site?

Run the production build, then deploy the generated directory.

1. Run `pnpm build`.
2. Deploy `dist/` with your hosting provider.
```

German:

```markdown
## Wie veröffentliche ich die Website?

Erstelle einen Produktions-Build und veröffentliche den Ausgabeordner.

1. Führe `pnpm build` aus.
2. Lade `dist/` beim Hosting-Anbieter hoch.
```

## Focused prose and structure

The first release uses fixed thresholds. Prose paragraphs longer than 150 words receive a reminder
to split them into focused sections. Code, quotations, lists, and tables are not measured as prose.
For explicit how-to titles, use an ordered list or numbered step headings. For explicit comparisons,
an accessible table can make differences easier to scan. An explicit FAQ should have question
headings followed by answers. These title patterns recognize English and German, including regional
tags such as `en-GB` and `de-DE`. Unknown or unsupported languages skip phrase detection; paragraph,
question-punctuation, attribution, dates, and percentage-symbol checks remain language-neutral.

```markdown
# Vergleich der Veröffentlichungsarten

| Variante | Geeignet für |
| --- | --- |
| Statisch | Seiten, die beim Build bekannt sind |
| Server | Inhalte, die zur Anfragezeit entstehen |
```

Do not force a table onto narrative content just to clear a finding. Keep genuine list semantics,
table headers, descriptive link labels, alternative text, and a meaningful heading hierarchy. Core
accessibility and technical audit rules remain independent of these editorial suggestions.

## Sources and attribution

Percentage and simple statistical claims receive advice when there is no source link in the same
paragraph. A link is only a citation signal: the audit does not verify evidence or visit that source.
Dates and version numbers are excluded. A citation in a different paragraph may not satisfy this
small, deliberately local heuristic.

Image destinations, URLs inside code, and contact links such as `mailto:` and `tel:` do not count
as citations. Hidden rendered descendants contribute neither prose nor citation links.

```markdown
In the sample, 42% chose the static option ([study](https://example.com/study)).

In der Stichprobe wählten 42 Prozent die statische Variante
([Studie](https://example.com/study)).
```

Articles should name their author in a Person/Organization JSON-LD author, visible author markup
(`rel="author"` or `itemprop="author"`), or author metadata. Same-page structured author references
are resolved where possible. Generic pages are not automatically treated as articles.

## Genuine dates

An article whose latest valid publication/modification date is more than 365 UTC days old receives
a review reminder. Age alone does not make evergreen content outdated. Review factual accuracy,
examples, source links, and instructions; change modification dates only after a genuine edit.
Missing or invalid calendar dates do not trigger the freshness reminder. Future dates are not
treated as old. Automated tests inject the current date for reproducibility.

## Analysis scope and false positives

Editorial analysis prefers an available Markdown companion, then rendered `main`, then `article`.
The audit cannot always distinguish authored Markdown from a generated companion, so it treats an
available companion as the preferred content representation. Noindex pages are skipped. Without
either a companion or a reliable content region, no editorial advice is emitted.

Heuristics are signals, not verdicts: percentages can describe examples rather than factual claims;
navigation can look like a question; legitimate prose can exceed the threshold; attribution may
use an unrecognized custom byline. Markdown parsing is intentionally lightweight, not an MDX
evaluator. Inspect the visible page before making changes. The checker never rewrites content.

## Schema matching visible content

Choose Schema.org types that describe what visitors actually see. Do not fabricate offers, reviews,
prices, authors, credentials, or business details. Components accept typed inputs and safely serialize
them, but cannot verify that claims match visible content.

`astro-aeo audit dist --schema-target google` adds separate, opt-in provider field checks. Google
requirements produce warnings with existing score deductions; recommendations are informational.
Schema.org validity is not Google eligibility, and neither establishes indexing, search visibility,
rich results, or AI citations. See [Google profile scope](GOOGLE_SCHEMA_PROFILES.md).
