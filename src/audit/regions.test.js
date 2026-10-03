// @ts-check
import {describe,it,expect} from 'vitest';
import {htmlRegions,regionLocator,markdownRegion} from './regions.js';
import {extractPageFacts} from './facts.js';
import {auditPages} from './site-rules.js';

describe('audited-byte source regions',() => {
  it('uses UTF-16 one-based columns and exclusive ends across newline spellings',() => {
    const locate = regionLocator('😀x\r\na\rb\nc');
    expect(locate(2,3)).toEqual({line:1,column:3,endLine:1,endColumn:4});
    expect(locate(7,8)).toEqual({line:3,column:1,endLine:3,endColumn:2});
  });
  it('ignores fake tags in comments, raw text, and ambiguous attributes',() => {
    const regions = htmlRegions('<!-- <a href="fake"> --><script>"<a href=bad>"</script><textarea><a href=bad></textarea><a href=x href=y><a href="/ok?a=1&amp;b=2">');
    expect(regions.filter((tag) => tag.tag === 'a')).toHaveLength(1);
    expect(regions.at(-1)?.attrs.href).toBe('/ok?a=1&b=2');
  });
  it('locates only the actual rendered link and does not invent missing element regions',() => {
    const html = '<html lang="en">\n<body><!--<a href="/missing">-->\n<a href="/missing">broken</a></body></html>';
    const page = extractPageFacts(html,{url:'/',file:'/index.html'});
    const findings = auditPages([page],{links:{resolve:() => ({key:'/missing',fragment:''}),lookup:() => undefined}});
    expect(findings.find((item) => item.ruleId === 'link-internal-broken')).toMatchObject({file:'/index.html',locationSource:'rendered-html',location:{line:3,column:1,endColumn:20}});
    expect(findings.find((item) => item.ruleId === 'description-missing')?.location).toBeUndefined();
  });
  it('locates companion residue after code examples, not guessed source files',() => {
    const markdown = '# Heading\n\n```html\n<div>example</div>\n```\n\n<div>real</div>';
    expect(markdownRegion(markdown,/<div/i)).toMatchObject({line:7,column:1});
    const page = extractPageFacts('<main>content</main>',{url:'/',file:'/index.html',markdown,markdownFile:'/index.md'});
    expect(auditPages([page]).find((item) => item.ruleId === 'markdown-html-residue')).toMatchObject({file:'/index.md',locationSource:'markdown',location:{line:7,column:1}});
  });
  it('refuses shifted JSON-LD source ordinals when a tag is ambiguous',() => {
    const html = '<script type="application/ld+json" type="application/ld+json">{bad}</script>\n<script type="application/ld+json">{bad}</script>';
    const page = extractPageFacts(html,{url:'/',file:'/index.html'});
    expect(auditPages([page]).filter((item) => item.ruleId === 'authored-jsonld-malformed').every((item) => !item.location)).toBe(true);
  });
});
