import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom/worker';
import { runInNewContext } from 'node:vm';
import { runReport } from '../report.js';
import { formatReport, formatJson } from '../validate-report.js';
import { trafficReport } from './traffic.js';
import { changesReport, changesFail } from './changes.js';
import { graphReport } from './graph.js';
import { renderDataReport } from './formats.js';
import { readText, readStream, readBaseline, safeFile, MAX_BYTES } from './io.js';
import { assertContract, assertSnapshot } from './contracts.js';
import { createPageSnapshot, evidenceHash } from '../../src/build/evidence.js';
import { planRagRecords, serializeRagRecords } from '../../src/core/rag.js';
import { BUILTIN_TOKENIZER_IDENTITY, countApproximateTokens } from '../../src/core/corpus-tokenizer.js';
import { renderMarkdownDocument } from '../../src/core/render/markdown-doc.js';
import { resolveConfig } from '../../src/config.js';
import { renderHtml } from '../formats/html.js';
import { createAuditReport } from '../../src/audit/report.js';

let root;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(),'aeo-report-')); });
afterEach(async () => { await rm(root,{recursive:true,force:true}); });
const event = (over = {}) => ({version:1,type:'request',timestamp:'2026-10-03T10:20:00.000Z',registryVersion:'2',
  method:'GET',status:200,path:'/guide',pathKind:'inventory',crawler:{identity:'unknown',classification:'unclassified'},
  representation:'markdown',cache:'unknown',surface:'node',sampleRate:0.5,scope:'agents',coverage:'observable-only',...over});
const sourcePage = (over = {}) => ({pathname:'/guide',url:'https://example.test/docs/guide',markdown:'# Guide\n\nHello.\n',title:'Guide',
  locale:'en',language:'en',version:'v2',...over});
const snapshot = (pages = [sourcePage()], ownership = [], complete = true) => createPageSnapshot(pages,ownership,complete);
const recalc = (value) => { const {buildDigest,...rest} = value; return {...rest,buildDigest:evidenceHash(rest)}; };
async function seed(file,value) { await mkdir(join(root,'.astro','aeo-cache'),{recursive:true}); await writeFile(join(root,'.astro','aeo-cache',file),JSON.stringify(value)); }
function cspHashes(html) {
  const {document} = parseHTML(html);
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  for (const node of document.querySelectorAll('style,script')) {
    const hash = createHash('sha256').update(node.textContent).digest('base64');
    expect(policy).toContain("'sha256-" + hash + "'");
  }
  expect(policy).not.toContain('unsafe-inline');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(document.querySelectorAll('[onclick],[onerror],script[src],link[href],img[src]')).toHaveLength(0);
  return document;
}

describe('frozen validator formatter relocation', () => {
  it('retains exact normal, strict, quiet and JSON output', () => {
    const value = {ok:true,errors:[],warnings:[{level:'warn',code:'x',message:'message'}],pagesChecked:2,artifactsChecked:3,sitemapsChecked:4};
    const summary = 'astro-aeo validate: 0 error(s), 1 warning(s) across 2 page(s), 3 artifact(s), 4 sitemap document(s)';
    expect(formatReport(value)).toBe('  ! [x] message\n\n' + summary + ' - PASS');
    expect(formatReport(value,{strict:true})).toBe('  ! [x] message\n\n' + summary + ' - FAIL');
    expect(formatReport(value,{quiet:true})).toBe('\n' + summary + ' - PASS');
    expect(formatJson(value)).toBe(JSON.stringify(value,null,2));
  });
});

describe('bounded privacy-fixed traffic inputs', () => {
  it('reports observed counts, UTC buckets, claimed identity and optional inverse sampling estimates', () => {
    const report = trafficReport([event(),event({timestamp:'2026-10-04T00:00:00.000Z',sampleRate:1}),event({status:304})].map(JSON.stringify).join('\n'),{weighted:true,from:'2026-10-03',to:'2026-10-04'});
    expect(report.observed).toBe(2); expect(report.estimated).toBe(4);
    expect(report.buckets).toEqual([{key:'2026-10-03',observed:2,estimated:4}]);
    expect(report.disclosure).toMatchObject({coverage:'observable-only',classification:'claimed',sampleRates:[0.5],weighted:true});
    assertContract(report,'analytics-report-v1');
    expect(trafficReport(JSON.stringify(event())).estimated).toBeUndefined();
  });
  it('accepts marked console input or bounded injected stdin, never treats chatter as events', async () => {
    const input = 'server listening\nastro-aeo:analytics-v1 ' + JSON.stringify(event()) + '\nnot data\n';
    const report = trafficReport(input,{bucket:'minute'});
    expect(report.buckets[0].key).toBe('2026-10-03T10:20:00.000Z');
    const result = await runReport(['traffic','-','--format','json'],{cwd:root,stdin:(async function*(){yield input;})()});
    expect(JSON.parse(result.output).observed).toBe(1);
  });
  it.each([{ip:'secret'},{query:'secret'},{referrer:'secret'},{headers:{authorization:'secret'}},{sampleRate:0},
    {sampleRate:2},{timestamp:'2026-02-31T10:20:00.000Z'},{path:'/x?secret=1'},{path:'/../secret'},{status:-1},{status:600},
    {crawler:{identity:'InventedBot',classification:'claimed'}},{pathKind:'unlisted'}])('rejects malformed or private fields without printing raw values: %j', (over) => {
    expect(() => trafficReport(JSON.stringify(event(over)))).toThrow('line 1');
    try { trafficReport(JSON.stringify(event(over))); } catch (error) { expect(error.message).not.toContain('secret'); }
  });
  it.each(['2026-02-31','2026-10-03T12:00:00+02:00','tomorrow'])('rejects non-UTC or invalid filter %s', (from) => {
    expect(() => trafficReport('',{from})).toThrow();
  });
  it('rejects reversed filters, overlong lines, oversized input and nonfinite weights', async () => {
    expect(() => trafficReport('',{from:'2026-10-04',to:'2026-10-03'})).toThrow('precede');
    expect(() => trafficReport('x'.repeat(65537))).toThrow('line limit');
    expect(() => trafficReport('x'.repeat(MAX_BYTES+1))).toThrow('byte limit');
    expect(() => trafficReport(JSON.stringify(event({sampleRate:Number.MIN_VALUE})),{weighted:true})).toThrow('finite');
    await expect(readStream((async function*(){yield Buffer.alloc(MAX_BYTES);yield 'x';})())).rejects.toThrow('byte limit');
  });
  it.each(['terminal','json','markdown','html'])('renders traffic %s with disclosures', async (format) => {
    const result = await runReport(['traffic','-','--format',format],{cwd:root,stdin:(async function*(){yield JSON.stringify(event());})()});
    expect(result.output).toContain('observable-only'); expect(result.exitCode).toBe(0);
    if (format === 'html') cspHashes(result.output);
  });
});

describe('component and ownership changes', () => {
  it('compares individual component hashes and ownership etags, with default nonfailure', async () => {
    const old = snapshot([sourcePage()],[{pathname:'/guide.md',status:'owned',owner:{name:'dotmd'},representation:{etag:'"'+'a'.repeat(64)+'"',byteLength:4}}]);
    const now = snapshot([sourcePage({markdown:'# Changed'})],[{pathname:'/guide.md',status:'owned',owner:{name:'dotmd'},representation:{etag:'"'+'b'.repeat(64)+'"',byteLength:5}}]);
    const report = changesReport(old,now);
    expect(report.pages[0].components).toEqual(['markdown']);
    expect(report.artifacts[0].components).toEqual(['etag','byteLength']);
    expect(changesFail(report,'none')).toBe(false); expect(changesFail(report,'changed')).toBe(true);
    await writeFile(join(root,'old.json'),JSON.stringify(old)); await writeFile(join(root,'now.json'),JSON.stringify(now));
    expect((await runReport(['changes','now.json','--baseline','old.json'],{cwd:root})).exitCode).toBe(0);
    expect((await runReport(['changes','now.json','--baseline','old.json','--fail-on','changed'],{cwd:root})).exitCode).toBe(1);
    assertContract(report,'changes-report-v1');
  });
  it('never confirms removals from an incomplete or digest-mismatched inventory', () => {
    const old = snapshot(), partial = snapshot([],[],false), forged = {...snapshot([]),buildDigest:old.buildDigest};
    for (const now of [partial,forged]) {
      const report = changesReport(old,now);
      expect(report.pages[0].status).toBe('unconfirmed-removal');
      expect(changesFail(report,'removed')).toBe(false);
      expect(report.warnings.join(' ')).toMatch(/cannot confirm removals/);
    }
    expect(changesReport(snapshot([],[],false),old).pages[0].status).toBe('unconfirmed-addition');
    expect(changesReport(old,snapshot([])).pages[0].status).toBe('removed');
  });
  it('rejects forged evidence fields, traversal and duplicate identities', () => {
    expect(() => assertSnapshot({...snapshot(),sourceBody:'secret'})).toThrow('does not match');
    expect(() => assertSnapshot({...snapshot(),pages:[{...snapshot().pages[0],pathname:'/%252e%252e/private'}]})).toThrow('unsafe');
    expect(() => assertSnapshot({...snapshot(),pages:[snapshot().pages[0],snapshot().pages[0]]})).toThrow('duplicate');
  });
  it('bounds URL baselines, rejects redirects and credentials, catches transport errors without leaking URLs', async () => {
    const fetcher = vi.fn(async (_url,options) => { expect(options.redirect).toBe('manual'); expect(options.signal).toBeDefined(); return new Response(JSON.stringify(snapshot())); });
    expect(await readBaseline('https://example.test/pages.json',fetcher)).toEqual(snapshot());
    await expect(readBaseline('https://secret@example.test/pages.json',fetcher)).rejects.toThrow('credentials');
    await expect(readBaseline('https://example.test/pages.json',async () => new Response('',{status:302}))).rejects.toThrow('usable');
    await expect(readBaseline('https://example.test/pages.json',async () => {throw new Error('secret');})).rejects.toThrow('Cannot fetch');
    await expect(readBaseline('https://example.test/pages.json',async () => new Response('{}',{headers:{'content-length':String(MAX_BYTES+1)}}))).rejects.toThrow('byte limit');
  });
});

describe('private inspection and safe exports', () => {
  it('joins a snapshot, trace and base-aware manifest with page filters and ownership checks', async () => {
    const manifest = {version:1,base:'/docs/',origin:'https://example.test',pages:[{id:'/guide',canonicalUrl:'https://example.test/docs/guide',markdownUrl:'https://example.test/docs/guide.md',locale:'en',version:'v2',hash:'sha256:'+'a'.repeat(64),tokenCount:5}],artifacts:[]};
    await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
    const snap = snapshot([sourcePage()],[{pathname:'/docs/llms/manifest.json',status:'owned',owner:{name:'corpusManifest'},representation:{etag:'"'+evidenceHash(JSON.stringify(manifest)).slice(7)+'"',byteLength:30}}]);
    await seed('pages-v1.json',snap);
    const trace = {version:1,buildDigest:snap.buildDigest,inventoryComplete:true,stages:[{pathname:'/guide',stage:'extract',outcome:'hit'}],
      pages:[{pathname:'/guide',source:'rendered',renderer:null,graphEntities:2,graphProvenance:{inference:2},htmlTransforms:[],diagnostics:{}}],
      artifacts:[],diagnostics:{},cacheReasons:{}};
    await seed('trace-v1.json',trace);
    const result = await runReport(['inspect','--manifest','manifest.json','--page','/guide','--format','json'],{cwd:root});
    expect(result.report.pages[0]).toMatchObject({snapshot:{pathname:'/guide'},trace:{graphEntities:2},companions:[{pathname:'/docs/guide.md',tokenCount:5}]});
    expect(result.warnings).toEqual([]);
    expect((await runReport(['inspect','--page','/other'],{cwd:root})).report.pages).toEqual([]);
    await seed('trace-v1.json',{...trace,buildDigest:'sha256:'+'b'.repeat(64)});
    expect((await runReport(['inspect'],{cwd:root})).warnings).toContain('Trace and snapshot digest mismatch.');
  });
  it('refuses linked cache parents, linked input/output and oversized files', async () => {
    await writeFile(join(root,'input'), '{}');
    await symlink(join(root,'input'),join(root,'link'));
    await expect(readText(join(root,'link'))).rejects.toThrow('symlink');
    await expect(runReport(['traffic','link'],{cwd:root})).rejects.toThrow('symlink');
    await mkdir(join(root,'outside'));
    await symlink(join(root,'outside'),join(root,'.astro'));
    await expect(runReport(['inspect'],{cwd:root})).rejects.toThrow('symlink');
    await writeFile(join(root,'big'),Buffer.alloc(MAX_BYTES+1));
    await expect(readText(join(root,'big'))).rejects.toThrow('byte limit');
    await expect(runReport(['traffic','-','--output','link'],{cwd:root,stdin:(async function*(){yield '';})()})).rejects.toThrow('symlink');
  });
  it('writes only explicit outputs atomically at 0600, preserving inputs', async () => {
    const input = JSON.stringify(event());
    await writeFile(join(root,'events'),input);
    const result = await runReport(['traffic','events','--format','json','--output','reports/traffic.json'],{cwd:root});
    expect(result.output).toBe(''); expect((await stat(join(root,'reports/traffic.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(root,'events'),'utf8')).toBe(input);
    expect((await readdir(join(root,'reports')))).toEqual(['traffic.json']);
  });
});

describe('offline graph HTML', () => {
  const hostile = '</script><img src=x onerror=alert(1)>&"\u2028';
  const graph = {'@context':'https://remote.invalid/context','@graph':[
    {'@id':'https://example.test/a','@type':'Article',name:hostile,author:{'@id':'https://example.test/b'}},
    {'@id':'https://example.test/b','@type':'Person',name:'Writer'},
    {'@id':'https://example.test/c','@type':'Article',name:'Other'},
  ]};
  it('extracts deterministic nodes and references without resolving remote contexts', () => {
    const report = graphReport(graph);
    expect(report.nodes).toHaveLength(3);
    expect(report.edges).toEqual([{from:'https://example.test/a',to:'https://example.test/b',property:'author'}]);
    expect(graphReport(graph,{node:'https://example.test/a',depth:1}).nodes).toHaveLength(2);
    expect(graphReport(graph,{type:'Person'}).nodes).toHaveLength(1);
    expect(() => graphReport(graph,{node:'missing'})).toThrow('absent');
    assertContract(report,'graph-report-v1');
  });
  it('pins exact script/style hashes, escapes hostile JSON and leaves a complete no-JS table', () => {
    const html = renderDataReport(graphReport(graph),'html');
    const document = cspHashes(html);
    expect(html).not.toContain(hostile);
    expect(document.querySelectorAll('#graph-nodes tbody tr')).toHaveLength(3);
    expect(document.querySelector('#graph-data').textContent).not.toContain('<');
    expect(document.querySelector('noscript').textContent).toContain('all selected nodes');
    expect(JSON.parse(document.querySelector('#graph-data').textContent).nodes[0].label).toBe(hostile);
  });
  it('filters and explores neighborhoods with safe DOM operations and no remote assets', () => {
    const document = cspHashes(renderDataReport(graphReport(graph),'html'));
    // Linkedom selects are read-only; fake the control value to exercise the actual shipped script.
    for (const id of ['graph-type','graph-center','graph-depth']) Object.defineProperty(document.getElementById(id),'value',{writable:true,value:id === 'graph-depth' ? '1' : ''});
    const script = [...document.querySelectorAll('script')].find((node) => !node.id).textContent;
    runInNewContext(script,{document});
    expect(document.getElementById('graph-count').textContent).toBe('3 visible node(s)');
    const center = document.getElementById('graph-center');
    center.value = 'https://example.test/a'; center.dispatchEvent(new document.defaultView.Event('input'));
    expect(document.getElementById('graph-count').textContent).toBe('2 visible node(s)');
    const query = document.getElementById('graph-query');
    query.value = 'Writer'; query.dispatchEvent(new document.defaultView.Event('input'));
    expect(document.getElementById('graph-count').textContent).toBe('1 visible node(s)');
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });
  it('applies equivalent CSP to no-script audit HTML', () => {
    const audit = createAuditReport({toolVersion:'1.6.0',target:{kind:'dist',value:'dist'},findings:[]});
    const document = cspHashes(renderHtml(audit));
    expect(document.querySelector('meta[http-equiv]').getAttribute('content')).toContain("script-src 'none'");
  });
});

describe('RAG export without configuration execution', () => {
  it('validates private index hashes, stable IDs, counts and disclosure, and exports JSONL', async () => {
    const {records} = await planRagRecords([sourcePage()],{maxTokens:5,tokenizer:BUILTIN_TOKENIZER_IDENTITY,count:async text => countApproximateTokens(text)});
    const directory = join(root,'.astro','aeo-cache','rag-v1');
    await mkdir(directory,{recursive:true});
    const body = serializeRagRecords(records), file = 'ab.jsonl', snap = createPageSnapshot([sourcePage()],[],true,records);
    await seed('pages-v1.json',snap);
    await writeFile(join(directory,file),body);
    const index = {version:1,buildDigest:snap.buildDigest,inventoryComplete:false,buildTimeIncomplete:true,files:[{file,locale:'en',contentVersion:'v2',records:records.length,hash:evidenceHash(body)}]};
    await writeFile(join(directory,'index-v1.json'),JSON.stringify(index));
    const result = await runReport(['rag'],{cwd:root});
    expect(result.output).toBe(body);
    expect(result.report.buildTimeIncomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('incomplete');
    expect((await runReport(['rag','--page','/absent'],{cwd:root})).output).toBe('');
    await writeFile(join(directory,file),body + ' ');
    await expect(runReport(['rag'],{cwd:root})).rejects.toThrow('hash mismatch');
  });
  it('reconstructs text/headings/stable chunk IDs from published companions with no prior RAG enablement', async () => {
    const dist = join(root,'dist'); await mkdir(dist);
    const page = sourcePage({pathname:'/guide',url:'https://example.test/docs/guide'});
    await writeFile(join(dist,'guide.md'),renderMarkdownDocument({...page,description:''},resolveConfig({markdown:{frontmatter:true}})));
    await writeFile(join(root,'astro.config.mjs'),'throw new Error("MUST NOT EXECUTE")');
    const result = await runReport(['rag','--max-tokens','4','--format','json'],{cwd:root});
    expect(result.report.source).toBe('companions');
    expect(result.report.buildTimeIncomplete).toBe(true);
    expect(result.report.records[0]).toMatchObject({text:page.markdown,metadata:{pathname:'/guide',url:page.url},tokenizer:BUILTIN_TOKENIZER_IDENTITY});
    expect(result.report.records.some(record => record.kind === 'chunk')).toBe(true);
    expect((await runReport(['rag','--max-tokens','4'],{cwd:root})).output).toBe(serializeRagRecords(result.report.records));
  });
  it('uses manifest base/locale/version topology and reports missing runtime companions', async () => {
    await mkdir(join(root,'dist','en'),{recursive:true});
    const page = sourcePage({pathname:'/en/guide',url:'https://example.test/docs/en/guide'});
    const body = renderMarkdownDocument({...page,description:''},resolveConfig());
    await writeFile(join(root,'dist','en','guide.md'),body);
    const descriptor = {id:'/en/guide',canonicalUrl:page.url,markdownUrl:page.url+'.md',locale:'en',language:'en',version:'v2',versionGroup:'guide',section:'Docs',hash:evidenceHash(body),tokenCount:countApproximateTokens(body)};
    const manifest = {version:1,base:'/docs/',origin:'https://example.test',pages:[descriptor,{...descriptor,id:'/en/missing',canonicalUrl:'https://example.test/docs/en/missing',markdownUrl:'https://example.test/docs/en/missing.md'}],artifacts:[]};
    await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
    await seed('pages-v1.json',snapshot([page]));
    const result = await runReport(['rag','--manifest','manifest.json','--format','json'],{cwd:root});
    expect(result.report.records[0].metadata).toMatchObject({pathname:'/en/guide',locale:'en',contentVersion:'v2',versionGroup:'guide'});
    expect(result.warnings).toContain('Some manifest companions are unavailable in the build output.');
    expect(result.warnings).not.toContain('A companion differs from its manifest content hash.');
  });
  it('requires known URLs for unwrapped Markdown, refuses linked companions and malformed private records', async () => {
    await mkdir(join(root,'dist')); await writeFile(join(root,'dist','guide.md'),'# Guide\n');
    await expect(runReport(['rag'],{cwd:root})).rejects.toThrow('--origin');
    expect((await runReport(['rag','--origin','https://example.test','--base','/docs'],{cwd:root})).report.records[0].metadata.url).toBe('https://example.test/docs/guide');
    await symlink(join(root,'dist','guide.md'),join(root,'dist','linked.md'));
    await expect(runReport(['rag','--origin','https://example.test'],{cwd:root})).rejects.toThrow('symlink');
  });
});

it.each([['other'],['traffic','--format','sarif'],['changes'],['graph','--depth','4'],['rag','--max-tokens','0'],['inspect','one','two']])('rejects unsupported report invocation %j', async (...args) => {
  await expect(runReport(args,{cwd:root})).rejects.toThrow();
});

describe('report identities and malformed contracts', () => {
  it('warns when deployment, ownership, snapshot or manifest evidence does not identify one build', async () => {
    const snap = snapshot([sourcePage()],[{pathname:'/guide.md',status:'emitted',owner:{name:'dotmd'},representation:{etag:'"'+'a'.repeat(64)+'"',byteLength:5}}]);
    await seed('pages-v1.json',snap);
    await seed('ownership-v1.json',{version:1,outputRootId:'sha256:'+'f'.repeat(64),artifacts:[{pathname:'/guide.md',status:'preserved'}]});
    await seed('deployment-v1.json',{version:1,ownershipDigest:'sha256:'+'e'.repeat(64)});
    const result = await runReport(['inspect','--format','json'],{cwd:root});
    expect(result.warnings).toEqual(expect.arrayContaining(['Ownership and selected build output digest mismatch.','Deployment and ownership digest mismatch.','Snapshot and ownership artifact evidence mismatch.']));
    expect(result.output).not.toContain(root);
    expect(result.output).not.toContain('outputRootId');
  });
  it('refuses arbitrary linked ancestors and invalid UTF-8 before parsing', async () => {
    await mkdir(join(root,'real')); await writeFile(join(root,'real','data'),JSON.stringify(event()));
    await symlink(join(root,'real'),join(root,'linked'));
    await expect(runReport(['traffic','linked/data'],{cwd:root})).rejects.toThrow('symlink');
    await expect(runReport(['traffic','-','--output','linked/result.json'],{cwd:root,stdin:(async function*(){yield '';})()})).rejects.toThrow('symlink');
    await expect(readStream((async function*(){yield Buffer.from([0xff]);})())).rejects.toThrow('UTF-8');
  });
  it('accepts a real project reached through a linked folder above its root', async () => {
    await mkdir(join(root,'real','proj','.astro','aeo-cache'),{recursive:true});
    await writeFile(join(root,'real','proj','.astro','aeo-cache','pages-v1.json'),JSON.stringify(snapshot()));
    await symlink(join(root,'real'),join(root,'link'));
    const project = join(root,'link','proj');
    expect((await runReport(['inspect','--format','json'],{cwd:project})).report.pages).toHaveLength(1);
    const written = await runReport(['inspect','--format','json','--output','reports/inspect.json'],{cwd:project});
    expect(written.written).toBe('reports/inspect.json');
    expect(JSON.parse(await readFile(join(root,'real','proj','reports','inspect.json'),'utf8')).type).toBe('inspect');
    // The root itself remains part of the checked path.
    await writeFile(join(root,'real','in.json'),'{}');
    await expect(safeFile(join(root,'link','in.json'),join(root,'link'))).rejects.toThrow('symlink');
  });
  it('rejects malformed trace contracts and refuses credentialed graph URLs', async () => {
    await seed('pages-v1.json',snapshot());
    await seed('trace-v1.json',{version:1,buildDigest:snapshot().buildDigest,inventoryComplete:true,stages:[],pages:[],artifacts:[],diagnostics:{},cacheReasons:{},rawDiagnostics:'secret'});
    await expect(runReport(['inspect'],{cwd:root})).rejects.toThrow('processing-trace');
    expect(() => graphReport({'@graph':[{'@id':'https://secret@example.test/x','@type':'Article'}]})).toThrow('credentials');
    expect(() => graphReport({'@graph':[{'@id':'https://example.test/x?secret=1','@type':'Article'}]})).toThrow('query');
    expect(() => graphReport({'@graph':[{'@id':4}]})).toThrow('identity');
  });
  it('rejects private RAG index traversal and rehashed malformed records', async () => {
    const directory = join(root,'.astro','aeo-cache','rag-v1'); await mkdir(directory,{recursive:true});
    const index = {version:1,buildDigest:snapshot().buildDigest,inventoryComplete:true,buildTimeIncomplete:false,
      files:[{file:'../secret.jsonl',locale:'en',contentVersion:'v2',records:1,hash:'sha256:'+'a'.repeat(64)}]};
    await writeFile(join(directory,'index-v1.json'),JSON.stringify(index));
    await expect(runReport(['rag'],{cwd:root})).rejects.toThrow('rag-index');
    const {records} = await planRagRecords([sourcePage()],{maxTokens:512,tokenizer:BUILTIN_TOKENIZER_IDENTITY,count:async text => countApproximateTokens(text)});
    for (const bad of [{...records[0],tokenCount:999},{...records[0],metadata:{...records[0].metadata,url:'https://secret@example.test/x'}},
      {...records[0],pageId:'page:'+'f'.repeat(64),id:'page:'+'f'.repeat(64)}]) {
      const body = serializeRagRecords([bad]);
      await writeFile(join(directory,'ab.jsonl'),body);
      await writeFile(join(directory,'index-v1.json'),JSON.stringify({...index,files:[{...index.files[0],file:'ab.jsonl',hash:evidenceHash(body)}]}));
      await expect(runReport(['rag'],{cwd:root})).rejects.toThrow();
    }
  });
});

it('cancels URL baseline delivery after two seconds without exposing transport diagnostics', async () => {
  vi.useFakeTimers();
  try {
    const pending = readBaseline('https://example.test/secret-token',async (_url,{signal}) => new Promise((_,reject) => {
      signal.addEventListener('abort',() => reject(new Error('secret-token')),{once:true});
    }));
    const rejected = expect(pending).rejects.toThrow('Cannot fetch baseline URL.');
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('caps streaming remote baselines even when Content-Length is absent', async () => {
  const response = new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(MAX_BYTES));controller.enqueue(new Uint8Array(1));controller.close();}}));
  await expect(readBaseline('https://example.test/data',async () => response)).rejects.toThrow('byte limit');
});

it('refuses exports over consumed inputs and private build evidence', async () => {
  const text = JSON.stringify(event()); await writeFile(join(root,'events'),text);
  await expect(runReport(['traffic','events','--output','events'],{cwd:root})).rejects.toThrow('must not overwrite input');
  await expect(runReport(['traffic','events','--output','.astro/aeo-cache/export.json'],{cwd:root})).rejects.toThrow('private build evidence');
  expect(await readFile(join(root,'events'),'utf8')).toBe(text);
});

it('preserves valid flat plugin metadata in private RAG exports', async () => {
  const {records} = await planRagRecords([sourcePage()],{maxTokens:512,tokenizer:BUILTIN_TOKENIZER_IDENTITY,count:async text => countApproximateTokens(text)});
  records[0].metadata.routePattern = 3;
  const body = serializeRagRecords(records), directory = join(root,'.astro/aeo-cache/rag-v1');
  await mkdir(directory,{recursive:true}); await writeFile(join(directory,'ab.jsonl'),body);
  await writeFile(join(directory,'index-v1.json'),JSON.stringify({version:1,buildDigest:snapshot().buildDigest,inventoryComplete:true,buildTimeIncomplete:false,
    files:[{file:'ab.jsonl',locale:'en',contentVersion:'v2',records:records.length,hash:evidenceHash(body)}]}));
  expect((await runReport(['rag'],{cwd:root})).output).toBe(body);
});
