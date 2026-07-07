// @ts-check
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchPath } from '../lib/match.js';

/**
 * Assign a page to the first matching section rule, or the default section.
 * @param {import('../lib/collect.js').PageInfo} page
 * @param {import('../index.js').SectionRule[]} sections
 * @param {string | false} defaultSection
 * @returns {string | null} section title, or null to drop the page
 */
export function sectionFor(page, sections, defaultSection) {
  for (const rule of sections) {
    if (typeof rule.match === 'function') {
      if (rule.match(page)) return rule.title;
    } else if (matchPath(page.pathname, rule.match)) {
      return rule.title;
    }
  }
  return defaultSection === false ? null : defaultSection;
}

/**
 * Group pages into ordered sections (rule order first, then any default-section
 * pages). Sections with no pages are dropped.
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {import('../index.js').SectionRule[]} sections
 * @param {string | false} defaultSection
 * @returns {{ title: string; pages: import('../lib/collect.js').PageInfo[] }[]}
 */
export function groupSections(pages, sections, defaultSection) {
  /** @type {Map<string, import('../lib/collect.js').PageInfo[]>} */
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
 * Write /llms.txt.
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 */
export function emitLlmsTxt(pages, distDir, config, siteName, siteDescription) {
  if (!config.llmsTxt.enabled) return;
  const eligible = pages.filter((p) => !p.aeoTokens.has('no-llms'));
  const groups = groupSections(eligible, config.llmsTxt.sections, config.llmsTxt.defaultSection);

  const lines = [`# ${siteName}`, ''];
  if (siteDescription) lines.push(`> ${siteDescription}`, '');

  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    for (const p of group.pages) lines.push(entryLine(p, config));
    lines.push('');
  }

  writeFileSync(join(fileURLToPath(distDir), 'llms.txt'), lines.join('\n'), 'utf8');
}

/**
 * @param {import('../lib/collect.js').PageInfo} p
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @returns {string}
 */
function entryLine(p, config) {
  let line = `- [${p.title}](${p.mdHref})`;
  if (config.llmsTxt.includeDescriptions && p.description) line += `: ${p.description}`;
  if (config.llmsTxt.showLastmod && p.lastModified) {
    line += ` _(updated ${p.lastModified.toISOString().slice(0, 10)})_`;
  }
  return line;
}

/**
 * Write /llms-full.txt (concatenated page content).
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 */
export function emitLlmsFullTxt(pages, distDir, config, siteName, siteDescription) {
  if (!config.llmsFullTxt.enabled) return;
  const eligible = pages.filter((p) => !p.aeoTokens.has('no-llms') && !p.aeoTokens.has('no-llms-full'));

  const selected =
    config.llmsFullTxt.mode === 'first-page-only'
      ? eligible.slice(0, 1)
      : config.llmsFullTxt.mode === 'index'
        ? eligible.filter((p) => p.pathname === '/')
        : eligible;

  const lines = [`# ${siteName}`, ''];
  if (siteDescription) lines.push(`> ${siteDescription}`, '');
  lines.push('---', '');

  for (const p of selected) {
    lines.push(`# ${p.title}`, '');
    lines.push(`URL: ${p.url}`);
    if (p.description) lines.push(`Description: ${p.description}`);
    lines.push('');
    lines.push(p.markdown);
    lines.push('', '---', '');
  }

  writeFileSync(join(fileURLToPath(distDir), 'llms-full.txt'), lines.join('\n'), 'utf8');
}
