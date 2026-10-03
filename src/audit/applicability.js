// @ts-check
import { AUDIT_CATEGORIES } from './rules.js';
/** Evidence-based applicability, not points for features that were never checked.
 * @param {readonly import('./facts.js').PageFacts[]} pages
 * @param {{mode:'offline'|'live'|'build';inventoryComplete?:boolean;discoveryObserved?:boolean;corpusObserved?:boolean;buildEvidenceObserved?:boolean}} options
 * @returns {import('../index.js').AuditApplicability[]} */
export function auditApplicability(pages,options) {
  const any = pages.length > 0, complete = options.inventoryComplete === true;
  const indexable = pages.some((page) => !page.noindex);
  const languages = new Set(pages.map((page) => page.language).filter(Boolean));
  const multilingual = languages.size > 1 || pages.some((page) => page.alternates.length > 0 || page.versionAlternates?.length);
  const markdown = pages.some((page) => page.markdown !== undefined);
  const graph = pages.some((page) => page.jsonLd.length > 0);
  const links = pages.some((page) => page.renderedHtml && page.links.length > 0);
  const evidence = {
    discovery: [options.discoveryObserved ? 'applicable' : 'unknown',options.discoveryObserved ? 'Discovery artifacts were inspected.' : 'Discovery artifacts were not inspected.'],
    metadata: [indexable ? 'applicable' : any ? 'not-applicable' : 'unknown',indexable ? 'Indexable page metadata was observed.' : any ? 'Observed pages are noindex.' : 'No page metadata was observed.'],
    markdown: [markdown ? 'applicable' : 'unknown',markdown ? 'Published companion content was observed.' : 'No published companion content was observed.'],
    corpus: [options.corpusObserved ? 'applicable' : 'unknown',options.corpusObserved ? 'Corpus artifacts were inspected.' : 'Corpus artifacts were not inspected.'],
    'structured-data': [graph ? 'applicable' : any && complete ? 'not-applicable' : 'unknown',graph ? 'Structured data declarations were observed.' : 'No structured data declarations were observed in this inventory.'],
    internationalization: [multilingual ? 'applicable' : any && complete && languages.size === 1 ? 'not-applicable' : 'unknown',multilingual ? 'Language or version alternates were observed.' : 'A multilingual inventory was not established.'],
    links: [links && options.mode !== 'build' ? 'applicable' : options.mode !== 'build' && complete && any ? 'not-applicable' : 'unknown',options.mode === 'build' ? 'Build records do not establish rendered link targets.' : links ? 'Rendered links and targets were inspected.' : 'No rendered links were observed in this inventory.'],
    build: [options.buildEvidenceObserved ? 'applicable' : 'unknown',options.buildEvidenceObserved ? 'Private build evidence was inspected.' : 'Private build evidence is unavailable.'],
  };
  return AUDIT_CATEGORIES.map((category) => ({category,status:/** @type {import('../index.js').AuditApplicability['status']} */ (evidence[category][0]),reason:evidence[category][1]}));
}
