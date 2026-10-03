// @ts-check
import {describe,it,expect} from 'vitest';
import {extractPageFacts} from './facts.js';
import {auditPages} from './site-rules.js';
import {auditApplicability} from './applicability.js';
const origin = 'https://example.test';
/** @param {string} path @param {unknown} graph */
const graphPage = (path,graph) => extractPageFacts('<html lang="en"><script type="application/ld+json">'+JSON.stringify(graph)+'</script></html>',{url:origin+path});
describe('site-wide audit evidence',() => {
  it('resolves full-site definitions but diagnoses a visited document with no definition',() => {
    const a = graphPage('/a',{'@type':'Article','@id':origin+'/a#article',author:{'@id':origin+'/b#person'}});
    const b = graphPage('/b',{'@type':'Person','@id':origin+'/b#person',name:'Author'});
    expect(auditPages([a,b],{siteUrl:origin}).filter((item) => item.ruleId === 'schema.unresolved-reference')).toEqual([]);
    const empty = extractPageFacts('<html lang="en"></html>',{url:origin+'/b'});
    expect(auditPages([a,empty],{siteUrl:origin}).some((item) => item.ruleId === 'schema.unresolved-reference')).toBe(true);
    expect(auditPages([a],{siteUrl:origin,inventoryComplete:false}).some((item) => item.ruleId === 'schema.unresolved-reference')).toBe(false);
  });
  it('compares visible main content within a locale/version without shared navigation',() => {
    const text = Array.from({length:45},(_,i) => 'word'+i).join(' ');
    const page = (/** @type {string} */ path,/** @type {string} */ body) => extractPageFacts('<html lang="en"><nav>shared chrome</nav><main>'+body+'</main></html>',{url:path});
    const a = page('/a',text), b = page('/b',text), c = page('/c',text+' different');
    const duplicates = (/** @type {import('./facts.js').PageFacts[]} */ pages) => auditPages(pages).filter((item) => item.ruleId === 'content-duplicate');
    expect(duplicates([a,b,c])).toHaveLength(2);
    expect(JSON.stringify(duplicates([a,b]))).not.toContain('word0');
    b.version='v1'; a.version='v2'; expect(duplicates([a,b])).toEqual([]);
    a.version='v1'; b.locale='fr'; a.locale='en'; expect(duplicates([a,b])).toEqual([]);
    b.locale='en'; a.canonical=b.canonical=origin+'/same'; expect(duplicates([a,b])).toEqual([]);
  });
  it('marks absent observations unknown rather than manufacturing successful coverage',() => {
    const page = extractPageFacts('<html lang="en"><main>hello</main></html>',{url:'/'});
    const local = auditApplicability([page],{mode:'offline',inventoryComplete:true});
    expect(local.find((entry) => entry.category === 'structured-data')?.status).toBe('not-applicable');
    expect(local.find((entry) => entry.category === 'corpus')?.status).toBe('unknown');
    expect(auditApplicability([page],{mode:'live'}).find((entry) => entry.category === 'internationalization')?.status).toBe('unknown');
  });
});
