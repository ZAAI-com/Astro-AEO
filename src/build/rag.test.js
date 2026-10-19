import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, lstatSync, rmSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { stagePrivateRag } from './rag.js';
import { stageCorpusArtifacts } from './corpus.js';
import { createArtifactWriter } from './artifacts.js';
import { createPageSnapshot, evidenceHash } from './evidence.js';
import { validateCorpusArtifacts } from '../../cli/validate-corpus.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { resolveConfig } from '../config.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root,{recursive:true,force:true})));
const page = (locale='en',version) => ({id:`/${locale}/${version??'guide'}`,pathname:`/${locale}/${version??'guide'}`,
  origin:'https://example.test',url:`https://example.test/${locale}/${version??'guide'}`,locale,language:locale,version,
  title:'Guide',description:'',markdown:'# Guide\n\nPublished text.',source:{body:'RAW MDX'},
  mdHref:`/${locale}/${version??'guide'}.md`,aeoTokens:[],directives:{index:true,includeInLlms:true,includeInLlmsFull:true,generateMarkdown:true}});
function project() {
  const root = mkdtempSync(join(tmpdir(),'aeo-rag-'));roots.push(root);mkdirSync(join(root,'dist'));
  const writer = (routes=[]) => createArtifactWriter({distDir:pathToFileURL(`${root}/dist/`),projectRoot:root,
    routePaths:routes,publicDir:pathToFileURL(`${root}/public/`),base:'',deferred:true,logger:{info(){},warn(){}}});
  return {root,writer};
}
const config = resolveConfig({corpus:{rag:{enabled:true,publish:true},manifest:{enabled:true},compression:{gzip:true}}});
const env = (writer, extra={}) => ({siteUrl:'https://example.test',base:'',siteMeta:{name:'Docs',description:''},writer,diagnostics:[],...extra});

test('private exports have 0600 modes, digest parity, locale/version partitioning and restoration without touching identical bytes', async () => {
  const {root,writer} = project();
  const build = async () => {
    const w=writer();const pages=[page('en'),page('fr','v1')];
    const corpus=await stageCorpusArtifacts(pages,resolveConfig({i18n:{indexes:'both'},corpus:{rag:{enabled:true},versions:{current:'v2'}}}),env(w));
    stagePrivateRag({projectRoot:root,writer:w,records:corpus.ragRecords,inventoryComplete:true,buildTimeIncomplete:false,
      buildDigest:()=>createPageSnapshot(pages,w.resolve().manifestEntries,true,corpus.ragRecords).buildDigest});
    w.commit();return corpus;
  };
  const first=await build();
  const dir=join(root,'.astro/aeo-cache/rag-v1');
  const index=JSON.parse(readFileSync(join(dir,'index-v1.json'),'utf8'));
  expect(index.files).toHaveLength(2);
  expect(index.buildTimeIncomplete).toBe(false);
  const filename=join(dir,index.files[0].file);const bytes=readFileSync(filename,'utf8');
  expect(bytes).not.toContain('RAW MDX');
  expect(evidenceHash(bytes)).toBe(index.files[0].hash);
  for(const entry of [...index.files,{file:'index-v1.json'}])expect(lstatSync(join(dir,entry.file)).mode&0o777).toBe(0o600);
  utimesSync(filename,new Date('2000-01-01Z'),new Date('2000-01-01Z'));const before=lstatSync(filename).mtimeMs;
  await build();expect(lstatSync(filename).mtimeMs).toBe(before);
  rmSync(filename);const second=await build();expect(readFileSync(filename,'utf8')).toBe(bytes);expect(second.ragRecords).toEqual(first.ragRecords);
});

test('incomplete/runtime-owned private exports disclose build-time incompleteness without inventing pages', () => {
  const {root,writer}=project();const w=writer();
  stagePrivateRag({projectRoot:root,writer:w,records:[],inventoryComplete:true,buildTimeIncomplete:true,buildDigest:()=>evidenceHash('build')});w.commit();
  expect(JSON.parse(readFileSync(join(root,'.astro/aeo-cache/rag-v1/index-v1.json'),'utf8'))).toMatchObject({inventoryComplete:true,buildTimeIncomplete:true,files:[]});
});

test('private RAG symlinks abort safely before any public artifact is written', async () => {
  const {root,writer}=project();const target=join(root,'keep.json');writeFileSync(target,'Keep');
  const dir=join(root,'.astro/aeo-cache/rag-v1');mkdirSync(dir,{recursive:true});symlinkSync(target,join(dir,'index-v1.json'));
  const w=writer();const corpus=await stageCorpusArtifacts([page()],config,env(w));
  stagePrivateRag({projectRoot:root,writer:w,records:corpus.ragRecords,inventoryComplete:true,buildTimeIncomplete:false,buildDigest:()=>evidenceHash('build')});
  expect(()=>w.commit()).toThrow(/symbolic link/);expect(readFileSync(target,'utf8')).toBe('Keep');
  expect(()=>readFileSync(join(root,'dist/llms/rag.jsonl'))).toThrow();
});

test('ownership arbitration removes conflicting RAG and gzip records without clobbering public bytes', async () => {
  const {root,writer}=project();mkdirSync(join(root,'public/llms'),{recursive:true});writeFileSync(join(root,'public/llms/rag.jsonl'),'Authored');
  const w=writer();const corpus=await stageCorpusArtifacts([page()],config,env(w));w.commit();
  expect(corpus.manifest.artifacts.some((entry)=>entry.kind==='rag')).toBe(false);
  expect(readFileSync(join(root,'public/llms/rag.jsonl'),'utf8')).toBe('Authored');
  expect(()=>readFileSync(join(root,'dist/llms/rag.jsonl.gz'))).toThrow();
});

test('published RAG gzip is deterministic, ownership-managed, and restoration is safe', async () => {
  const {root,writer}=project();const w=writer();w.write({route:page().mdHref,owner:'dotmd',contents:renderMarkdownDocument(page(),config)});
  const corpus=await stageCorpusArtifacts([page()],config,env(w));w.commit();
  const out={errors:[],warnings:[]};validateCorpusArtifacts(join(root,'dist'),'',out);expect(out.errors).toEqual([]);
  const rag=readFileSync(join(root,'dist/llms/rag.jsonl'),'utf8');
  expect(gunzipSync(readFileSync(join(root,'dist/llms/rag.jsonl.gz'))).toString()).toBe(rag);
  expect(corpus.manifest.artifacts.filter((entry)=>entry.kind==='rag')).toHaveLength(2);
  const again=writer();await stageCorpusArtifacts([page()],config,env(again));again.commit();
  expect(readFileSync(join(root,'dist/llms/rag.jsonl'),'utf8')).toBe(rag);
  const disabled=writer();await stageCorpusArtifacts([page()],resolveConfig(),env(disabled));disabled.commit();
  expect(()=>readFileSync(join(root,'dist/llms/rag.jsonl'))).toThrow();
});

test('warm RAG record and tokenization caches reuse narrow identities independently of hooks', async () => {
  const {writer}=project();const cache=new Map();const counts={miss:0,hit:0};
  const stageCache={key:(stage,inputs)=>`${stage}:${JSON.stringify(inputs)}`,get(key){if(cache.has(key))counts.hit++;return cache.get(key);},put(key,value){cache.set(key,value);counts.miss++;}};
  await stageCorpusArtifacts([page()],config,env(writer(),{cache:stageCache}));const before=counts.miss;
  await stageCorpusArtifacts([page()],config,env(writer(),{cache:stageCache}));expect(counts.miss).toBe(before);expect(counts.hit).toBeGreaterThan(0);
  const modified={...page(),markdown:'# Guide\n\nEdited text.'};
  const second=await stageCorpusArtifacts([modified],config,env(writer(),{cache:stageCache}));expect(counts.miss).toBeGreaterThan(before);
  expect(second.ragRecords[0].text).toContain('Edited');
});
