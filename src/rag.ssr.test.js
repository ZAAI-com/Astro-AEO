import { afterAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(repo,'.astro'),{recursive:true});
const root=mkdtempSync(join(repo,'.astro/rag-ssr-'));
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function write(file,body){const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);}
const env=()=>{const value={...process.env,ASTRO_DEV_BACKGROUND:'1'};delete value.NODE_ENV;delete value.NODE_OPTIONS;
  for(const key of Object.keys(value))if(/^(VITEST|__VITEST|TINYPOOL)/.test(key))delete value[key];return value;};
async function port(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const value=socket.address().port;socket.close();await once(socket,'close');return value;}
function get(listenPort,path,method='GET'){return new Promise((resolve,reject)=>{
  const request=httpRequest({hostname:'127.0.0.1',port:listenPort,path,method,headers:{host:'rag.example.test'}},(response)=>{
    const chunks=[];response.on('data',(chunk)=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString()}));});
  request.on('error',reject);request.end();});}

test('Node middleware serves complete locale/version RAG, HEAD and validated runtime hooks while private build exports disclose incompleteness', async()=>{
  write('package.json','{"type":"module"}\n');
  write('catalog.mjs',`export default { name:'docs',apiVersion:1,listPages(){return [
    {pathname:'/en/guide',locale:'en',canonicalUrl:'https://rag.example.test/docs/en/guide'},
    {pathname:'/en/v1/guide',locale:'en',version:'v1',canonicalUrl:'https://rag.example.test/docs/en/v1/guide'}];} };`);
  write('plugin.mjs',`export default {name:'rag-metadata',apiVersion:1,setup(api){api.on('rag:record',({value})=>{
    if(process.env.AEO_RAG_INVALID==='1')return {action:'replace',value:{...value,text:'forged'}};
    return {action:'replace',value:{...value,metadata:{...value.metadata,category:'runtime'}}};});}};`);
  write('astro.config.mjs',`import {defineConfig} from 'astro/config';import node from '@astrojs/node';import aeo from 'astro-aeo';
    export default defineConfig({site:'https://rag.example.test',base:'/docs',output:'server',adapter:node({mode:'standalone'}),
      integrations:[aeo({markdown:{includeLastModified:false},i18n:{indexes:'both'},
        pages:{catalogs:[{module:'./catalog.mjs'}]},
        corpus:{versions:{current:'v2',order:['v1']},rag:{enabled:true,publish:true,maxTokens:20},manifest:{enabled:true}},
        discovery:{sitemap:{mode:'disabled'}},
        plugins:[{name:'rag-metadata',apiVersion:1,runtime:{entrypoint:new URL('./plugin.mjs',import.meta.url)},setup(api){api.on('rag:record',()=>{});}}]})]});`);
  write('src/pages/[...path].astro',`---
import {AeoPage} from 'astro-aeo/components';
const path=Astro.params.path??'';const version=path.includes('/v1/')?'v1':undefined;
---
<html lang="en"><head><title>Runtime docs</title></head><body><AeoPage markdown={\`# Public docs\n\nPublished \${version??'v2'} guide.\`} version={version}/><main><h1>Runtime docs</h1></main></body></html>`);
  const astroPackage=JSON.parse(readFileSync(join(repo,'node_modules/astro/package.json'),'utf8'));
  const astro=join(repo,'node_modules/astro',typeof astroPackage.bin==='string'?astroPackage.bin:astroPackage.bin.astro);
  execFileSync(process.execPath,[astro,'build','--root',root],{cwd:repo,env:env(),stdio:'pipe'});
  const index=JSON.parse(readFileSync(join(root,'.astro/aeo-cache/rag-v1/index-v1.json'),'utf8'));
  expect(index).toMatchObject({version:1,inventoryComplete:false,buildTimeIncomplete:true,files:[]});
  const snapshot=JSON.parse(readFileSync(join(root,'.astro/aeo-cache/pages-v1.json'),'utf8'));
  expect(index.buildDigest).toBe(snapshot.buildDigest);
  const run=async(invalid,callback)=>{
    const listenPort=await port();const child=spawn(process.execPath,[join(root,'dist/server/entry.mjs')],
      {cwd:root,env:{...env(),HOST:'127.0.0.1',PORT:String(listenPort),AEO_RAG_INVALID:invalid?'1':'0'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',(chunk)=>output+=chunk);child.stderr.on('data',(chunk)=>output+=chunk);
    try{
      for(let attempt=0;;attempt++){try{await get(listenPort,'/docs/en/guide');break;}catch{if(attempt>100)throw Error(output);await new Promise(resolve=>setTimeout(resolve,50));}}
      await callback(listenPort,()=>output);
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}}
  };
  await run(false,async(listenPort,output)=>{
    const current=await get(listenPort,'/docs/en/llms/rag.jsonl');expect(current.status,current.body+'\n'+output()).toBe(200);
    expect(current.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const records=current.body.trim().split('\n').map(line=>JSON.parse(line));
    expect(records).toHaveLength(2);expect(records.every(record=>record.metadata.contentVersion==='v2'&&record.metadata.category==='runtime')).toBe(true);
    const archive=await get(listenPort,'/docs/en/v1/llms/rag.jsonl');expect(archive.status,archive.body).toBe(200);
    expect(archive.body).toContain('Published v1');expect(archive.body).not.toContain('Published v2');
    const head=await get(listenPort,'/docs/en/v1/llms/rag.jsonl','HEAD');expect(head.status).toBe(200);expect(head.body).toBe('');
    const manifest=JSON.parse((await get(listenPort,'/docs/llms/manifest.json')).body);
    expect(manifest.artifacts).toContainEqual(expect.objectContaining({pathname:'/docs/en/v1/llms/rag.jsonl',kind:'rag'}));
  });
  await run(true,async(listenPort)=>{const failed=await get(listenPort,'/docs/en/llms/rag.jsonl');expect(failed.status).toBe(500);expect(failed.body).not.toContain('forged');});
});
