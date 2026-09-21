// @ts-check
import { validateGraph } from '../schema.js';
import { createFinding, fromGraphFinding } from './finding.js';

/**
 * Site-wide rules over `PageFacts`. Every cross-page check goes through a map
 * keyed by a normalized value, so the work stays linear in pages plus links.
 *
 * @typedef {import('./facts.js').PageFacts} PageFacts
 * @typedef {import('../index.js').Finding} Finding
 *
 * @typedef {object} LinkResolver
 * @property {(from: PageFacts, href: string) => { key: string; fragment: string } | null} resolve
 *   Identity of an internal target, or null for an external or non-navigable href.
 * @property {(key: string) => PageFacts | null | undefined} lookup
 *   The target page, null for an existing non-page resource, undefined when nothing is there.
 */

export const THIN_MARKDOWN_WORDS = 40;

const RESIDUE = /<\/?(?:div|span|section|article|nav|header|footer|script|style|iframe)\b/i;

/**
 * @param {readonly PageFacts[]} pages
 * @param {{ links?: LinkResolver; siteUrl?: string }} [options]
 * @returns {Finding[]}
 */
export function auditPages(pages, options = {}) {
  /** @type {Finding[]} */
  const findings = [];
  for (const page of pages) {
    auditMetadata(page, findings);
    auditMarkdown(page, findings);
    auditStructuredData(page, options.siteUrl, findings);
  }
  auditDuplicates(pages, findings);
  if (options.links) {
    auditLinks(pages, options.links, findings);
    auditAlternates(pages, options.links, findings);
  }
  return findings;
}

/** @param {PageFacts} page @param {Finding[]} findings */
function auditMetadata(page, findings) {
  if (page.noindex) return;
  if (!page.description) {
    findings.push(at(page, 'description-missing', 'warning', `no meta description: ${page.url}`));
  }
  if (!page.language && page.file) {
    findings.push(at(page, 'html-lang-missing', 'warning', `the html element has no lang attribute: ${page.url}`));
  }
}

/** @param {PageFacts} page @param {Finding[]} findings */
function auditMarkdown(page, findings) {
  if (page.markdown === undefined) return;
  const prose = stripFences(page.markdown);
  // Link and image destinations are not prose, and a word needs a letter or a digit.
  const words = prose.replace(/\]\([^)\n]*\)/g, ']').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  if (words === 0) {
    findings.push(at(page, 'markdown-empty', 'error', `the Markdown companion is empty: ${page.url}`));
    return;
  }
  if (words < THIN_MARKDOWN_WORDS && !page.noindex) {
    findings.push(at(page, 'markdown-thin', 'warning',
      `the Markdown companion has ${words} words, fewer than ${THIN_MARKDOWN_WORDS}: ${page.url}`));
  }
  if (!/^#\s+\S/m.test(prose)) {
    findings.push(at(page, 'markdown-no-h1', 'warning', `the Markdown companion has no top-level heading: ${page.url}`));
  }
  const residue = RESIDUE.exec(prose);
  if (residue) {
    findings.push({
      ...at(page, 'markdown-html-residue', 'warning', `the Markdown companion still contains layout HTML: ${page.url}`),
      evidence: residue[0],
    });
  }
}

/**
 * Entities are validated one at a time, without their `@context` and without
 * strict references, exactly as the build inspects authored JSON-LD: one bad
 * third-party node must not hide the rest, and an `@id` defined on another page
 * is a legitimate reference.
 *
 * @param {PageFacts} page @param {string | undefined} siteUrl @param {Finding[]} findings
 */
function auditStructuredData(page, siteUrl, findings) {
  const canonical = absolute(page.canonical) ?? absolute(page.url);
  for (const body of page.jsonLd) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      findings.push(at(page, 'authored-jsonld-malformed', 'error', `a JSON-LD script is not valid JSON: ${page.url}`));
      continue;
    }
    for (const entity of graphEntities(parsed)) {
      const { '@context': _context, ...withoutContext } = entity;
      // Audited JSON is untyped by nature; the validator is what decides whether it is an entity.
      const result = validateGraph(/** @type {any} */ ([withoutContext]), {
        ...(canonical ? { documentCanonical: canonical } : {}),
        ...(siteUrl ? { siteUrl } : {}),
        strictReferences: false,
      });
      for (const graphFinding of result.findings) {
        findings.push({
          ...fromGraphFinding({ ...graphFinding, pathname: page.url }),
          ...(page.file ? { file: page.file } : {}),
        });
      }
    }
  }
}

/** @param {unknown} value @returns {Record<string, unknown>[]} */
function graphEntities(value) {
  if (Array.isArray(value)) return value.flatMap(graphEntities);
  if (!value || typeof value !== 'object') return [];
  const record = /** @type {Record<string, unknown>} */ (value);
  return Array.isArray(record['@graph']) ? record['@graph'].flatMap(graphEntities) : [record];
}

/** @param {readonly PageFacts[]} pages @param {Finding[]} findings */
function auditDuplicates(pages, findings) {
  /** @type {[keyof PageFacts & ('title'|'description'|'canonical'), string, string][]} */
  const checks = [
    ['title', 'title-duplicate', 'title'],
    ['description', 'description-duplicate', 'meta description'],
    ['canonical', 'canonical-duplicate', 'canonical URL'],
  ];
  for (const [field, ruleId, label] of checks) {
    /** @type {Map<string, PageFacts[]>} */
    const groups = new Map();
    for (const page of pages) {
      const value = page[field];
      if (!value || page.noindex) continue;
      const group = groups.get(value);
      if (group) group.push(page);
      else groups.set(value, [page]);
    }
    for (const [value, group] of groups) {
      if (group.length < 2) continue;
      const urls = group.map((page) => page.url).sort();
      for (const page of group) {
        const others = urls.filter((url) => url !== page.url);
        findings.push({
          ...at(page, ruleId, 'warning',
            `${label} is shared with ${others.length} other page(s), first ${others[0]}: ${page.url}`),
          evidence: value,
        });
      }
    }
  }
}

/** @param {readonly PageFacts[]} pages @param {LinkResolver} links @param {Finding[]} findings */
function auditLinks(pages, links, findings) {
  for (const page of pages) {
    const seen = new Set();
    for (const href of page.links) {
      if (seen.has(href)) continue;
      seen.add(href);
      const target = links.resolve(page, href);
      if (!target) continue;
      const found = links.lookup(target.key);
      if (found === undefined) {
        findings.push({ ...at(page, 'link-internal-broken', 'error', `internal link has no target: ${page.url}`), evidence: href });
      } else if (found && target.fragment && !found.anchors.has(target.fragment)) {
        findings.push({ ...at(page, 'link-anchor-missing', 'warning', `link fragment has no matching id: ${page.url}`), evidence: href });
      }
    }
  }
}

/** @param {readonly PageFacts[]} pages @param {LinkResolver} links @param {Finding[]} findings */
function auditAlternates(pages, links, findings) {
  for (const page of pages) {
    for (const alternate of page.alternates) {
      const target = links.resolve(page, alternate.href);
      if (!target) continue;
      const found = links.lookup(target.key);
      if (found === undefined) {
        findings.push({
          ...at(page, 'hreflang-target-missing', 'error', `hreflang ${alternate.language} points at a missing page: ${page.url}`),
          evidence: alternate.href,
        });
        continue;
      }
      if (!found || found === page) continue;
      const returns = found.alternates.some((back) => {
        const resolved = links.resolve(found, back.href);
        return resolved !== null && links.lookup(resolved.key) === page;
      });
      if (!returns) {
        findings.push({
          ...at(page, 'hreflang-return-missing', 'warning',
            `hreflang ${alternate.language} target does not link back: ${page.url}`),
          evidence: alternate.href,
        });
      }
    }
  }
}

/** @param {PageFacts} page @param {string} ruleId @param {Finding['severity']} severity @param {string} message */
function at(page, ruleId, severity, message) {
  return createFinding({ ruleId, severity, message, url: page.url, file: page.file });
}

/** @param {string} markdown */
function stripFences(markdown) {
  return markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** @param {string | undefined} value */
function absolute(value) {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}
