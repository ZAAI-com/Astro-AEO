// @ts-check
import { writeFileSync } from 'node:fs';
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
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 */
export function emitLlmsTxt(pages, distDir, config, siteName, siteDescription) {
  if (!config.corpus.index.enabled) return;
  const body = renderLlmsTxt(pages, config, { name: siteName, description: siteDescription });
  writeFileSync(join(fileURLToPath(distDir), 'llms.txt'), body, 'utf8');
}

/**
 * Write /llms-full.txt (concatenated page content).
 * @param {import('../lib/collect.js').PageInfo[]} pages
 * @param {URL} distDir
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {string} siteName
 * @param {string} siteDescription
 */
export function emitLlmsFullTxt(pages, distDir, config, siteName, siteDescription) {
  if (!config.corpus.full.enabled) return;
  const body = renderLlmsFullTxt(pages, config, { name: siteName, description: siteDescription });
  writeFileSync(join(fileURLToPath(distDir), 'llms-full.txt'), body, 'utf8');
}
