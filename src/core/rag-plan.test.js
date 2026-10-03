import { expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { planCorpusArtifacts } from './corpus-artifacts.js';
import { createPluginDispatcher } from '../plugins/dispatcher.js';
import { validateRagReplacement } from './rag.js';
import { countApproximateTokens } from './corpus-tokenizer.js';
import { isPotentialCorpusArtifactPath, corpusRoutePatterns } from './corpus-topology.js';
import { sha256Digest } from './corpus-manifest.js';

const origin = 'https://example.test';
const page = (locale = 'en', version) => ({ id: `/${locale}/${version ?? 'guide'}`, pathname: `/${locale}/${version ?? 'guide'}`,
  ...(version ? {version} : {}), locale, language: locale, origin, url: `${origin}/${locale}/${version ?? 'guide'}`,
  title: 'Guide', description: '', markdown: '# Guide\n\nPublic paragraph.', source: {body:'PRIVATE MDX'},
  mdHref: `/${locale}/${version ?? 'guide'}.md`, aeoTokens: [],
  directives: {index:true,includeInLlms:true,includeInLlmsFull:true,generateMarkdown:true} });
const input = (options = {}, pages = [page()]) => ({config:resolveConfig(options),pages,origin,base:'/docs',siteMeta:{name:'Docs',description:''}});
const hook = (dispatcher) => (record) => dispatcher.run('rag:record', record, {pathname:record.metadata.pathname,
  validate:(value) => validateRagReplacement(value, record)});

test('private is default and disabled plans have no records, artifacts or routes', async () => {
  const disabled = await planCorpusArtifacts(input());
  expect(disabled).not.toHaveProperty('ragRecords');
  const privateInput = input({corpus:{rag:{enabled:true}}});
  const plan = await planCorpusArtifacts(privateInput);
  expect(plan.ragRecords).toHaveLength(2);
  expect(plan.artifacts).toEqual(disabled.artifacts);
  expect(isPotentialCorpusArtifactPath('/llms/rag.jsonl',privateInput.config)).toBe(false);
  expect(corpusRoutePatterns(privateInput.config).join('\n')).not.toContain('rag');
});

test.each(['auto','global','locale','both'])('uses shared %s base/locale/version topology and request-time parity', async (indexes) => {
  const request = input({i18n:{indexes},corpus:{rag:{enabled:true,publish:true},versions:{current:'v2',order:['v1']},manifest:{enabled:true}}},
    [page('en'),page('fr'),page('en','v1'),page('fr','v1')]);
  const plan = await planCorpusArtifacts(request);
  expect(plan.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  const rag = plan.artifacts.filter((entry) => entry.kind === 'rag');
  const root = ['/llms/rag.jsonl','/v1/llms/rag.jsonl'];
  const localized = ['/en/llms/rag.jsonl','/fr/llms/rag.jsonl','/en/v1/llms/rag.jsonl','/fr/v1/llms/rag.jsonl'];
  expect(rag.map((entry) => entry.pathname).sort()).toEqual((indexes==='global' ? root : indexes==='both' ? [...root,...localized] : localized).sort());
  for (const artifact of rag) {
    expect(isPotentialCorpusArtifactPath(artifact.pathname,request.config)).toBe(true);
    const records = artifact.contents.trim().split('\n').map((line) => JSON.parse(line));
    expect(records.every((record) => record.metadata.contentVersion === artifact.version)).toBe(true);
    expect(artifact.contents).not.toContain('PRIVATE MDX');
    expect(plan.manifest.artifacts).toContainEqual(expect.objectContaining({pathname:`/docs${artifact.pathname}`,kind:'rag',hash:await sha256Digest(artifact.contents)}));
  }
  expect((await planCorpusArtifacts({...request,requestTime:true})).ragRecords).toEqual(plan.ragRecords);
});

test('RAG can be the only enabled public corpus and canonical manifest family', async () => {
  const plan = await planCorpusArtifacts(input({corpus:{index:{enabled:false},full:{enabled:false},rag:{enabled:true,publish:true},manifest:{enabled:true}}}));
  expect(plan.manifest.locales[0].canonicalArtifact).toBe('/docs/llms/rag.jsonl');
});

test('one tokenizer transaction restarts all versions before hooks run exactly once', async () => {
  const request = input({corpus:{rag:{enabled:true,publish:true},versions:{current:'v2',order:['v1']}}},[page('en'),page('en','v1')]);
  let hooks = 0;
  const plan = await planCorpusArtifacts({...request,tokenizerProbed:true,tokenizer:{apiVersion:1,name:'custom',version:'1',approximate:false,
    count(text){if(text.includes('v1'))throw Error('SECRET');return text.length;}},
    ragHook:async(record)=>{hooks++;return {value:record,isolated:false,diagnostics:[]};}});
  expect(hooks).toBe(4);
  expect(plan.ragRecords.every((record) => record.tokenizer.name === 'astro-aeo-approx' && record.tokenCount===countApproximateTokens(record.text))).toBe(true);
  expect(plan.diagnostics.filter((entry) => entry.code === 'corpus-tokenizer-fallback')).toHaveLength(1);
});

test('validated replacement and explicit record drop update public JSONL and manifest hashes', async () => {
  const dispatcher = await createPluginDispatcher({command:'build',plugins:[{name:'rag',apiVersion:1,setup(api){
    api.on('rag:record',({value}) => value.kind==='page' ? {action:'drop'} :
      {action:'replace',value:{...value,metadata:{...value.metadata,category:'documentation'}}});}}]});
  const plan = await planCorpusArtifacts({...input({corpus:{rag:{enabled:true,publish:true},manifest:{enabled:true}}}),ragHook:hook(dispatcher)});
  expect(plan.ragRecords).toHaveLength(1);
  expect(plan.ragRecords[0].metadata.category).toBe('documentation');
  const artifact = plan.artifacts.find((entry)=>entry.kind==='rag');
  expect(artifact.tokenCount).toBe(countApproximateTokens(artifact.contents));
  expect(plan.manifest.artifacts.find((entry)=>entry.kind==='rag').hash).toBe(await sha256Digest(artifact.contents));
});

test.each(['malformed','isolate','throw'])('fails closed for %s hooks, not an authorized drop', async (behavior) => {
  const dispatcher = await createPluginDispatcher({command:'build',plugins:[{name:'rag',apiVersion:1,setup(api){
    api.on('rag:record',({value})=>{if(behavior==='throw')throw Error('SECRET');
      return behavior==='isolate'?{action:'isolate'}:{action:'replace',value:{...value,text:'FORGED'}};},{recoverable:behavior==='malformed'});}}]});
  const plan = await planCorpusArtifacts({...input({corpus:{rag:{enabled:true,publish:true}}}),ragHook:hook(dispatcher)});
  expect(plan.ragRecords).toEqual([]);
  expect(plan.artifacts.some((entry)=>entry.kind==='rag')).toBe(false);
  expect(JSON.stringify(plan.diagnostics)).not.toContain('SECRET');
});

test('authorized thrown exceptions keep valid records and continue later hooks', async () => {
  const dispatcher = await createPluginDispatcher({command:'build',plugins:[{name:'rag',apiVersion:1,setup(api){
    api.on('rag:record',()=>{throw Error('SECRET');},{recoverable:true});
    api.on('rag:record',({value})=>({action:'replace',value:{...value,metadata:{...value.metadata,category:'later'}}}));}}]});
  const plan = await planCorpusArtifacts({...input({corpus:{rag:{enabled:true}}}),ragHook:hook(dispatcher)});
  expect(plan.ragRecords.every((record)=>record.metadata.category==='later')).toBe(true);
  expect(plan.diagnostics.every((entry)=>entry.code==='plugin-hook-recovered')).toBe(true);
});


test('replacement metadata count failures restart every version/family with one tokenizer identity', async () => {
  const request=input({corpus:{rag:{enabled:true,publish:true},versions:{current:'v2',order:['v1']},manifest:{enabled:true}}},[page('en'),page('en','v1')]);
  const dispatcher=await createPluginDispatcher({command:'build',plugins:[{name:'labels',apiVersion:1,setup(api){
    api.on('rag:record',({value})=>({action:'replace',value:{...value,metadata:{...value.metadata,category:'metadata-count-failure'}}}));}}]});
  const plan=await planCorpusArtifacts({...request,ragHook:hook(dispatcher),tokenizerProbed:true,
    tokenizer:{apiVersion:1,name:'custom',version:'1',approximate:false,count(text){
      if(text.includes('metadata-count-failure'))throw Error('PRIVATE DIAGNOSTIC');return text.length;}}});
  expect(plan.manifest.tokenizer.name).toBe('astro-aeo-approx');
  expect(plan.manifest.tokenizerFallback).toEqual({reason:'count'});
  expect(plan.ragRecords.every(record=>record.tokenizer.name==='astro-aeo-approx'&&record.tokenCount===countApproximateTokens(record.text))).toBe(true);
  expect(plan.artifacts.every(artifact=>artifact.tokenCount===countApproximateTokens(artifact.contents))).toBe(true);
  expect(plan.manifests.every(scoped=>scoped.manifest.tokenizer.name==='astro-aeo-approx')).toBe(true);
  expect(JSON.stringify(plan.diagnostics)).not.toContain('PRIVATE DIAGNOSTIC');
});
