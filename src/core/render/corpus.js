// @ts-check
import {
  groupSections,
  isLlmsEligible,
  renderLlmsEntryLine,
  selectFullTxtPages,
} from './llms-txt.js';

/**
 * @typedef {object} CorpusFragmentPage
 * @property {string} id
 * @property {string} title
 * @property {string} canonicalUrl
 * @property {string} [description]
 */

/**
 * Render a root language directory. Links are supplied as deployed paths or
 * absolute URLs so this helper never guesses an origin or Astro base.
 * @param {{ name: string; description: string }} siteMeta
 * @param {readonly { language: string; href: string }[]} locales
 */
export function renderLanguageDirectory(siteMeta, locales) {
  const lines = sitePreamble(siteMeta);
  lines.push('## Languages', '');
  for (const locale of locales) lines.push(`- [${locale.language}](${locale.href})`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Render a multilingual root llms index. Caller order is authoritative for
 * locales; section-rule order remains authoritative within each locale.
 * @param {readonly { language: string; pages: any[] }[]} locales
 * @param {any} config
 * @param {{ name: string; description: string }} siteMeta
 */
export function renderGroupedLlmsTxt(locales, config, siteMeta) {
  const lines = sitePreamble(siteMeta);
  for (const locale of locales) {
    const eligible = locale.pages.filter((page) => isLlmsEligible(page, config));
    const sections = groupSections(
      eligible,
      config.corpus.index.sections,
      config.corpus.index.defaultSection,
    );
    if (sections.length === 0) continue;
    lines.push(`## ${locale.language}`, '');
    for (const section of sections) {
      lines.push(`### ${section.title}`, '');
      for (const page of section.pages) lines.push(renderLlmsEntryLine(page, config));
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * Render a multilingual full corpus with one site preamble. Page wrappers are
 * byte-compatible with the records in the legacy full renderer.
 * @param {readonly { language: string; pages: any[] }[]} locales
 * @param {any} config
 * @param {{ name: string; description: string }} siteMeta
 */
export function renderGroupedLlmsFullTxt(locales, config, siteMeta) {
  const lines = sitePreamble(siteMeta);
  for (const locale of locales) {
    const selected = selectFullTxtPages(locale.pages, config);
    if (selected.length === 0) continue;
    lines.push(`## ${locale.language}`, '', '---', '');
    for (const page of selected) {
      lines.push(...pageRecordLines({
        page: {
          id: /** @type {any} */ (page).id ?? page.pathname,
          title: page.title,
          canonicalUrl: /** @type {any} */ (page).canonicalUrl ?? page.url,
          description: page.description,
        },
        blocks: page.markdown === '' ? [] : [page.markdown],
        includeDescription: true,
      }));
    }
  }
  return lines.join('\n');
}

/**
 * Render selected page prefixes grouped by locale and section. Empty sections
 * and locales disappear. Each selection is an exact page record, including a
 * wrapper-only record when `blocks` is empty.
 *
 * @param {{
 *   siteMeta: { name: string; description: string };
 *   locales: readonly {
 *     language: string | null;
 *     sections: readonly { title: string; selections: readonly { page: CorpusFragmentPage; blocks: readonly string[]; includeDescription?: boolean }[] }[];
 *   }[];
 *   groupLanguages?: boolean;
 * }} input
 */
export function renderSectionedCorpus(input) {
  const lines = sitePreamble(input.siteMeta);
  for (const locale of input.locales) {
    const sections = locale.sections.filter((section) => section.selections.length > 0);
    if (sections.length === 0) continue;
    if (input.groupLanguages) lines.push(`## ${locale.language ?? 'und'}`, '');
    for (const section of sections) {
      lines.push(`${input.groupLanguages ? '###' : '##'} ${section.title}`, '', '---', '');
      for (const selection of section.selections) {
        lines.push(...pageRecordLines({
          page: selection.page,
          blocks: selection.blocks,
          includeDescription: selection.includeDescription !== false,
        }));
      }
    }
  }
  return lines.join('\n');
}

/**
 * Render fragments for one chunk. A chunk has no site or section preamble;
 * its pathname already supplies section context.
 * @param {readonly { page: CorpusFragmentPage; blocks: readonly string[]; includeDescription: boolean }[]} fragments
 */
export function renderChunkFragments(fragments) {
  const lines = [];
  for (const fragment of fragments) lines.push(...pageRecordLines(fragment));
  return lines.join('\n');
}

/**
 * Render one page wrapper and its contiguous Markdown prefix.
 * @param {{ page: CorpusFragmentPage; blocks: readonly string[]; includeDescription: boolean }} fragment
 */
export function renderCorpusPageFragment(fragment) {
  return pageRecordLines(fragment).join('\n');
}

/**
 * @param {{ page: CorpusFragmentPage; blocks: readonly string[]; includeDescription: boolean }} fragment
 */
function pageRecordLines(fragment) {
  const lines = [`# ${fragment.page.title}`, '', `URL: ${fragment.page.canonicalUrl}`];
  if (fragment.includeDescription && fragment.page.description) {
    lines.push(`Description: ${fragment.page.description}`);
  }
  lines.push('');
  if (fragment.blocks.length > 0) lines.push(fragment.blocks.join('\n\n'));
  lines.push('', '---', '');
  return lines;
}

/** @param {{ name: string; description: string }} siteMeta */
function sitePreamble(siteMeta) {
  const lines = [`# ${siteMeta.name}`, ''];
  if (siteMeta.description) lines.push(`> ${siteMeta.description}`, '');
  return lines;
}
