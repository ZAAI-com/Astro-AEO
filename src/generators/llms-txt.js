// @ts-check
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLlmsTxt, renderLlmsFullTxt } from '../core/render/llms-txt.js';

// The section and eligibility helpers live in core/render so the dev server and
// the build share one definition. Re-exported here because this module is the
// established import site for them.
export {
  sectionFor,
  groupSections,
  isLlmsEligible,
  llmsEntryHref,
  selectFullTxtPages,
} from '../core/render/llms-txt.js';

/**
 * Write /llms.txt.
 * @param {import('../build/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 * @param {ReturnType<typeof import('../build/artifacts.js').createArtifactWriter>} writer
 */
export function emitLlmsTxt(pages, distDir, config, siteName, siteDescription, writer) {
  if (!config.corpus.index.enabled) return;
  writer.write({
    path: join(fileURLToPath(distDir), 'llms.txt'),
    owner: 'llmsTxt',
    route: '/llms.txt',
    contents: renderLlmsTxt(pages, config, { name: siteName, description: siteDescription }),
    onConflict: 'overwrite',
  });
}

/**
 * Write /llms-full.txt (concatenated page content).
 * @param {import('../build/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 * @param {ReturnType<typeof import('../build/artifacts.js').createArtifactWriter>} writer
 */
export function emitLlmsFullTxt(pages, distDir, config, siteName, siteDescription, writer) {
  if (!config.corpus.full.enabled) return;
  writer.write({
    path: join(fileURLToPath(distDir), 'llms-full.txt'),
    owner: 'llmsFullTxt',
    route: '/llms-full.txt',
    contents: renderLlmsFullTxt(pages, config, { name: siteName, description: siteDescription }),
    onConflict: 'overwrite',
  });
}
