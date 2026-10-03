// @ts-check
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {auditLive} from './live.js';
import {countApproximateTokens} from '../core/corpus-tokenizer.js';
import {auditLiveDiscovery,DISCOVERY_LIMIT} from './live-discovery.js';
const origin='https://example.test';
const text='# Example\n\nContent.\n';
const hash='sha256:'+createHash('sha256').update(text).digest('hex');
const manifest={version:1,origin,base:'/docs',tokenizer:{name:'astro-aeo-approx',version:'1',approximate:true},locales:[{origin,locale:null,language:null,canonicalArtifact:'/docs/llms-full.txt'}],pages:[],artifacts:[{origin,pathname:'/docs/llms-full.txt',kind:'full',locale:null,section:null,part:null,hash,tokenCount:countApproximateTokens(text),encoding:'identity',sourcePathname:null}]};
describe('opt-in bounded live discovery',() => {
 it('leaves default crawling unchanged and rejects credentialed links',async() => {
   const calls=[];
   const fetch=/** @type {typeof globalThis.fetch} */ (async(url,init) => {calls.push(String(url));expect(init?.credentials).toBe('omit');return new Response('<html lang="en"><a href="https://user:secret@example.test/private">bad</a></html>',{headers:{'content-type':'text/html'}});});
   const report=await auditLive(origin,{fetch});
   expect(calls).toEqual([origin+'/']);expect(report.scope.artifactsFetched).toBeUndefined();
   expect(report.applicability.find((item) => item.category==='corpus')?.status).toBe('unknown');
 });
 it('checks manifest hashes and token counts without executing custom modules',async() => {
   const paths=[];
   const request=async(/** @type {string} */ url) => {paths.push(url);return {status:200,url,body:url.endsWith('manifest.json')?JSON.stringify(manifest):url.endsWith('domain-profile.json')?JSON.stringify({url:origin+'/docs/'}):url.endsWith('robots.txt')?'User-agent: *\n':text,contentType:url.endsWith('.json')?'application/json':'text/plain'};};
   const result=await auditLiveDiscovery(origin,'/docs',request,[]);
   expect(result.findings).toEqual([]);expect(paths.filter((path) => path.endsWith('llms-full.txt'))).toHaveLength(1);
   manifest.artifacts[0].hash='sha256:'+'0'.repeat(64);manifest.artifacts[0].tokenCount=1;
   const bad=await auditLiveDiscovery(origin,'/docs',request,[]);
   expect(bad.findings.map((item) => item.ruleId)).toEqual(expect.arrayContaining(['live-corpus-hash','live-corpus-tokens']));
   manifest.artifacts[0].hash=hash;manifest.artifacts[0].tokenCount=countApproximateTokens(text);
 });
 it('bounds sitemap recursion and never requests out-of-base or credentialed advertisements',async() => {
   const calls=[];
   const request=async(/** @type {string} */ url) => {calls.push(url);return {status:200,url,contentType:'text/plain',body:url.endsWith('robots.txt')?'Sitemap: https://secret:pw@example.test/private.xml\nSitemap: https://example.test/out.xml\nSitemap: https://example.test/docs/0.xml':url.endsWith('.xml')?'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:150},(_,i)=>'<sitemap><loc>'+origin+'/docs/'+(i+1)+'.xml</loc></sitemap>').join('')+'</sitemapindex>':url.endsWith('manifest.json')?'{}':url.endsWith('domain-profile.json')?JSON.stringify({url:origin+'/docs/'}):text};};
   const result=await auditLiveDiscovery(origin,'/docs',request,[]);
   expect(calls.length).toBeLessThanOrEqual(DISCOVERY_LIMIT);
   expect(calls.every((url) => url.startsWith(origin+'/docs/'))).toBe(true);
   expect(JSON.stringify(result)).not.toContain('secret');expect(result.complete).toBe(false);
   expect(result.findings.some((item) => item.ruleId==='live-discovery-limit')).toBe(true);
 });
 it('rejects DTD XML and reports only sanitized parser evidence',async() => {
   const request=async(/** @type {string} */ url) => ({status:200,url,contentType:'text/plain',body:url.endsWith('robots.txt')?'Sitemap: '+origin+'/sitemap.xml':url.endsWith('.xml')?'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///private">]><urlset>&secret;</urlset>':url.endsWith('manifest.json')?'{}':url.endsWith('domain-profile.json')?JSON.stringify({url:origin+'/'}):text});
   const result=await auditLiveDiscovery(origin,'/',request,[]);
   expect(result.findings.some((item) => item.ruleId==='live-sitemap-invalid')).toBe(true);
   expect(JSON.stringify(result)).not.toContain('file:///private');
 });
});

it('normalizes decoded Unicode deployment bases before comparing HTTP paths',async() => {
 const calls=[];
 const request=async(/** @type {string} */ url) => {calls.push(url);return {status:url.endsWith('.json')?404:200,url,contentType:'text/plain',body:url.endsWith('robots.txt')?'User-agent: *':text};};
 const result=await auditLiveDiscovery(origin,'/café',request,[]);
 expect(calls.every((url) => url.startsWith(origin+'/caf%C3%A9/'))).toBe(true);
 expect(result.findings).toEqual([]);
});

it('checks artifact wire hashes without normalizing away newline mutations',async() => {
 const request=async(/** @type {string} */ url) => ({status:200,url,body:url.endsWith('manifest.json')?JSON.stringify(manifest):url.endsWith('domain-profile.json')?JSON.stringify({url:origin+'/docs/'}):url.endsWith('robots.txt')?'User-agent: *':text.replaceAll('\n','\r\n'),contentType:url.endsWith('.json')?'application/json':'text/plain'});
 const result=await auditLiveDiscovery(origin,'/docs',request,[]);
 expect(result.findings.some((item) => item.ruleId==='live-corpus-hash')).toBe(true);
 expect(result.findings.some((item) => item.ruleId==='live-corpus-tokens')).toBe(false);
});
