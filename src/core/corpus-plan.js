// @ts-check
import { scanMarkdownBlocks } from './corpus-blocks.js';
import { compareCodeUnits } from './corpus-manifest.js';
import { renderChunkFragments, renderSectionedCorpus } from './render/corpus.js';

/**
 * @typedef {object} PlanPage
 * @property {string} id
 * @property {string} title
 * @property {string} canonicalUrl
 * @property {string} markdown
 * @property {string} [description]
 */

/**
 * Deterministically allocate a small corpus. Every page gets at most one new
 * leading Markdown block per pass. Complete rendered candidates are counted,
 * so custom tokenizers do not need to be additive.
 *
 * @param {{
 *   siteMeta: { name: string; description: string };
 *   locales: readonly {
 *     locale: string | null;
 *     language: string | null;
 *     sections: readonly { title: string; pages: readonly PlanPage[] }[];
 *   }[];
 *   groupLanguages?: boolean;
 *   maxTokens: number;
 *   count: (text: string) => Promise<number>;
 * }} input
 */
export async function allocateSmallCorpus(input) {
  validateBudget(input.maxTokens);
  const locales = input.locales.map((locale) => ({
    locale: locale.locale,
    language: locale.language,
    sections: locale.sections.map((section) => ({
      title: section.title,
      pages: [...section.pages]
        .sort(comparePages)
        .map((page) => ({
          page,
          blocks: scanMarkdownBlocks(page.markdown).map((block) => block.text),
          included: 0,
          admitted: false,
          stopped: false,
        })),
    })),
  }));

  /** @type {Array<{ code: string; pageId?: string; locale?: string | null; section?: string; block?: number; message: string }>} */
  const diagnostics = [];
  const render = () => renderSectionedCorpus({
    siteMeta: input.siteMeta,
    groupLanguages: input.groupLanguages,
    locales: locales.map((locale) => ({
      language: locale.language,
      sections: locale.sections.map((section) => ({
        title: section.title,
        selections: section.pages
          .filter((state) => state.admitted)
          .map((state) => ({
            page: state.page,
            blocks: state.blocks.slice(0, state.included),
            includeDescription: true,
          })),
      })),
    })),
  });

  const emptyText = render();
  const emptyCount = await input.count(emptyText);
  if (emptyCount > input.maxTokens) {
    return {
      text: '',
      tokenCount: 0,
      pages: [],
      diagnostics: [{
        code: 'small-corpus-preamble-over-budget',
        message: `The small-corpus preamble requires ${emptyCount} tokens and exceeds the ${input.maxTokens}-token budget.`,
      }],
    };
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const locale of locales) {
      for (const section of locale.sections) {
        for (const state of section.pages) {
          if (state.stopped) continue;

          if (!state.admitted) {
            state.admitted = true;
            const wrapperText = render();
            const wrapperCount = await input.count(wrapperText);
            if (wrapperCount > input.maxTokens) {
              state.admitted = false;
              state.stopped = true;
              diagnostics.push({
                code: 'small-corpus-wrapper-omitted',
                pageId: state.page.id,
                locale: locale.locale,
                section: section.title,
                message: `The wrapper for "${state.page.id}" does not fit within the remaining small-corpus budget.`,
              });
              continue;
            }
            changed = true;
            if (state.blocks.length === 0) {
              state.stopped = true;
              continue;
            }
          }

          const blockIndex = state.included;
          state.included++;
          const candidateText = render();
          const candidateCount = await input.count(candidateText);
          if (candidateCount <= input.maxTokens) {
            changed = true;
            if (state.included === state.blocks.length) state.stopped = true;
            continue;
          }

          state.included--;
          state.stopped = true;
          diagnostics.push({
            code: state.included === 0
              ? 'small-corpus-first-block-omitted'
              : 'small-corpus-truncated',
            pageId: state.page.id,
            locale: locale.locale,
            section: section.title,
            block: blockIndex,
            message: state.included === 0
              ? `The first indivisible block for "${state.page.id}" does not fit; its wrapper was retained.`
              : `The remaining blocks for "${state.page.id}" do not fit and were omitted.`,
          });
        }
      }
    }
  }

  const text = render();
  const tokenCount = await input.count(text);
  return {
    text,
    tokenCount,
    pages: locales.flatMap((locale) => locale.sections.flatMap((section) => section.pages
      .filter((state) => state.admitted)
      .map((state) => ({
        id: state.page.id,
        locale: locale.locale,
        section: section.title,
        includedBlocks: state.included,
        totalBlocks: state.blocks.length,
      })))),
    diagnostics,
  };
}

/**
 * Split one locale/section stream into deterministic chunks. A Markdown block
 * is indivisible; required continuation context can therefore make a chunk
 * exceed its configured maximum.
 *
 * @param {{ pages: readonly PlanPage[]; maxTokens: number; count: (text: string) => Promise<number> }} input
 */
export async function planSectionChunks(input) {
  validateBudget(input.maxTokens);
  /** @type {Array<{ part: number; text: string; tokenCount: number; overBudget: boolean; pageIds: string[] }>} */
  const chunks = [];
  /** @type {Array<{ page: PlanPage; blocks: string[]; includeDescription: boolean }>} */
  let fragments = [];
  /** @type {Array<{ code: string; pageId: string; block?: number; part: number; message: string }>} */
  const diagnostics = [];

  const finalize = async (overBudget = false) => {
    if (fragments.length === 0) return;
    const text = renderChunkFragments(fragments);
    const tokenCount = await input.count(text);
    chunks.push({
      part: chunks.length + 1,
      text,
      tokenCount,
      overBudget: overBudget || tokenCount > input.maxTokens,
      pageIds: [...new Set(fragments.map((fragment) => fragment.page.id))],
    });
    fragments = [];
  };

  for (const page of [...input.pages].sort(comparePages)) {
    const blocks = scanMarkdownBlocks(page.markdown).map((block) => block.text);
    const units = blocks.length > 0 ? blocks : [null];
    let emittedForPage = false;

    for (let blockIndex = 0; blockIndex < units.length; blockIndex++) {
      const unit = units[blockIndex];
      const last = fragments.at(-1);
      const extendsCurrentFragment = unit !== null && last?.page.id === page.id;
      const proposed = fragments.map((fragment) => ({ ...fragment, blocks: [...fragment.blocks] }));
      if (extendsCurrentFragment) {
        proposed[proposed.length - 1].blocks.push(unit);
      } else {
        proposed.push({
          page,
          blocks: unit === null ? [] : [unit],
          includeDescription: !emittedForPage,
        });
      }

      const candidateText = renderChunkFragments(proposed);
      const candidateCount = await input.count(candidateText);
      if (candidateCount <= input.maxTokens) {
        fragments = proposed;
        continue;
      }

      if (fragments.length > 0) {
        const currentContainsPage = fragments.some((fragment) => fragment.page.id === page.id);
        await finalize();
        if (currentContainsPage) emittedForPage = true;
      }

      fragments = [{
        page,
        blocks: unit === null ? [] : [unit],
        includeDescription: !emittedForPage,
      }];
      const indivisibleText = renderChunkFragments(fragments);
      const indivisibleCount = await input.count(indivisibleText);
      if (indivisibleCount > input.maxTokens) {
        const part = chunks.length + 1;
        diagnostics.push({
          code: 'corpus-chunk-over-budget',
          pageId: page.id,
          ...(unit === null ? {} : { block: blockIndex }),
          part,
          message: `An indivisible unit for "${page.id}" requires ${indivisibleCount} tokens and exceeds the ${input.maxTokens}-token chunk budget.`,
        });
        await finalize(true);
        emittedForPage = true;
      }
    }
  }
  await finalize();

  return { chunks, diagnostics };
}

/** @param {PlanPage} left @param {PlanPage} right */
function comparePages(left, right) {
  return compareCodeUnits(left.canonicalUrl, right.canonicalUrl) || compareCodeUnits(left.id, right.id);
}

/** @param {number} value */
function validateBudget(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Corpus token budget must be a positive safe integer.');
  }
}
