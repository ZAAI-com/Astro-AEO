// @ts-check
import { matchPath } from '../match.js';
import { isoDate } from './markdown-doc.js';

/**
 * The page fields these renderers need. Deliberately narrower than the build's
 * page record: nothing here may depend on a filesystem path, because the same
 * functions run at request time where no build output exists.
 *
 * @typedef {object} LlmsPage
 * @property {string} pathname
 * @property {string} url
 * @property {string} mdHref
 * @property {string} title
 * @property {string} description
 * @property {string} markdown
 * @property {string[]} aeoTokens
 * @property {{ includeInLlms: boolean; includeInLlmsFull: boolean; generateMarkdown: boolean }} [directives]
 * @property {string | undefined} [lastModified]
 */

/**
 * Assign a page to the first matching section rule, or the default section.
 * @param {LlmsPage} page
 * @param {import('../../index.js').SectionRule[]} sections
 * @param {string | false} defaultSection
 * @returns {string | null} section title, or null to drop the page
 */
export function sectionFor(page, sections, defaultSection) {
  for (const rule of sections) {
    if (typeof rule.match === 'function') {
      if (rule.match(page)) return rule.title;
    } else if (rule.match !== undefined && matchPath(page.pathname, rule.match)) {
      return rule.title;
    }
  }
  return defaultSection === false ? null : defaultSection;
}

/**
 * Group pages into ordered sections (rule order first, then any default-section
 * pages). Sections with no pages are dropped.
 * @param {LlmsPage[]} pages
 * @param {import('../../index.js').SectionRule[]} sections
 * @param {string | false} defaultSection
 * @returns {{ title: string; pages: LlmsPage[] }[]}
 */
export function groupSections(pages, sections, defaultSection) {
  /** @type {Map<string, LlmsPage[]>} */
  const buckets = new Map();
  const order = [];
  for (const rule of sections) {
    if (!buckets.has(rule.title)) {
      buckets.set(rule.title, []);
      order.push(rule.title);
    }
  }
  if (defaultSection !== false && !buckets.has(defaultSection)) {
    buckets.set(defaultSection, []);
    order.push(defaultSection);
  }

  for (const page of pages) {
    const title = sectionFor(page, sections, defaultSection);
    if (title === null) continue;
    const bucket = buckets.get(title) ?? [];
    bucket.push(page);
    buckets.set(title, bucket);
    if (!order.includes(title)) order.push(title);
  }

  return order
    .map((title) => ({ title, pages: buckets.get(title) ?? [] }))
    .filter((s) => s.pages.length > 0);
}

/**
 * Whether a page should appear in llms.txt. Pages with `no-llms` are always
 * dropped; pages with `no-dotmd` are dropped unless `corpus.index.includeHtmlOnly`
 * is on (they have no .md companion to link, so by default they are omitted
 * rather than left with a dangling link).
 * @param {{ aeoTokens: string[]; directives?: { includeInLlms: boolean; generateMarkdown: boolean } }} p
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @returns {boolean}
 */
export function isLlmsEligible(p, config) {
  if (p.aeoTokens.includes('no-llms') || p.directives?.includeInLlms === false) return false;
  if (
    (p.aeoTokens.includes('no-dotmd') || p.directives?.generateMarkdown === false) &&
    !config.corpus.index.includeHtmlOnly
  ) return false;
  return true;
}

/**
 * The llms.txt link target for a page: its `.md` companion, or (for a `no-dotmd`
 * page listed via `includeHtmlOnly`) its HTML URL.
 * @param {{ aeoTokens: string[]; mdHref: string; url: string; directives?: { generateMarkdown: boolean } }} p
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @returns {string}
 */
export function llmsEntryHref(p, config) {
  return p.aeoTokens.includes('no-dotmd') || p.directives?.generateMarkdown === false
    ? p.url
    : p.mdHref;
}

/**
 * Which pages llms-full.txt inlines. Extracted so build and request time cannot
 * apply different modes: the dev server used to ignore the setting entirely and
 * always emit every eligible page.
 * @param {LlmsPage[]} pages
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @returns {LlmsPage[]}
 */
export function selectFullTxtPages(pages, config) {
  const eligible = pages.filter(
    (p) =>
      !p.aeoTokens.includes('no-llms') &&
      !p.aeoTokens.includes('no-llms-full') &&
      p.directives?.includeInLlms !== false &&
      p.directives?.includeInLlmsFull !== false,
  );
  if (config.corpus.full.mode === 'first-page-only') return eligible.slice(0, 1);
  if (config.corpus.full.mode === 'index') return eligible.filter((p) => p.pathname === '/');
  return eligible;
}

/**
 * @param {LlmsPage} p
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @returns {string}
 */
function entryLine(p, config) {
  let line = `- [${p.title}](${llmsEntryHref(p, config)})`;
  if (config.corpus.index.includeDescriptions && p.description) line += `: ${p.description}`;
  if (config.corpus.index.showLastModified && p.lastModified) {
    line += ` _(updated ${isoDate(p.lastModified)})_`;
  }
  return line;
}

/**
 * Render /llms.txt.
 * @param {LlmsPage[]} pages
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {{ name: string; description: string }} siteMeta
 * @param {{ note?: string }} [opts]  `note` is the dev-preview banner; the build passes none.
 * @returns {string}
 */
export function renderLlmsTxt(pages, config, siteMeta, opts = {}) {
  const eligible = pages.filter((p) => isLlmsEligible(p, config));
  const groups = groupSections(
    eligible,
    config.corpus.index.sections,
    config.corpus.index.defaultSection,
  );

  const lines = [`# ${siteMeta.name}`, ''];
  if (siteMeta.description) lines.push(`> ${siteMeta.description}`, '');
  if (opts.note) lines.push(opts.note, '');

  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    for (const p of group.pages) lines.push(entryLine(p, config));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render /llms-full.txt (concatenated page content).
 * @param {LlmsPage[]} pages
 * @param {import('../../index.js').ResolvedAstroAeoConfig} config
 * @param {{ name: string; description: string }} siteMeta
 * @param {{ note?: string }} [opts]
 * @returns {string}
 */
export function renderLlmsFullTxt(pages, config, siteMeta, opts = {}) {
  const selected = selectFullTxtPages(pages, config);

  const lines = [`# ${siteMeta.name}`, ''];
  if (siteMeta.description) lines.push(`> ${siteMeta.description}`, '');
  if (opts.note) lines.push(opts.note, '');
  lines.push('---', '');

  for (const p of selected) {
    lines.push(`# ${p.title}`, '');
    lines.push(`URL: ${p.url}`);
    if (p.description) lines.push(`Description: ${p.description}`);
    lines.push('');
    lines.push(p.markdown);
    lines.push('', '---', '');
  }

  return lines.join('\n');
}
