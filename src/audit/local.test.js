// @ts-check
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditDist } from './local.js';
import { createAuditReport, serializeAuditReport } from './report.js';

/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const WORDS = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');

/** @param {{ title: string; description?: string; canonical?: string; body?: string; head?: string; lang?: string }} page */
function html(page) {
  return `<!doctype html><html${page.lang === '' ? '' : ` lang="${page.lang ?? 'en'}"`}><head><title>${page.title}</title>`
    + (page.description ? `<meta name="description" content="${page.description}">` : '')
    + (page.canonical ? `<link rel="canonical" href="${page.canonical}">` : '')
    + `${page.head ?? ''}</head><body><main><h1 id="top">${page.title}</h1>${page.body ?? ''}</main></body></html>`;
}

/** @param {Record<string, string>} files */
function site(files) {
  const project = mkdtempSync(join(tmpdir(), 'astro-aeo-audit-'));
  roots.push(project);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(project, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return project;
}

/** @param {string} project @param {Parameters<typeof auditDist>[1]} [options] */
function rulesOf(project, options) {
  return auditDist(join(project, 'dist'), options).findings;
}

describe('offline audit', () => {
  it('reports the legacy validator findings under their original codes', () => {
    const findings = auditDist('fixtures/dist-broken').findings;
    expect(findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(['missing-md', 'orphan-md', 'no-llms-full']));
  });

  it('finds broken links and missing anchors, and accepts every spelling of a real target', () => {
    const project = site({
      'dist/index.html': html({
        title: 'Home',
        description: 'Home page',
        body: '<a href="/about">a</a><a href="/about/">b</a><a href="about/index.html#top">c</a><a href="/logo.svg">d</a>'
          + '<a href="/gone/">e</a><a href="/about/#nope">f</a><a href="https://elsewhere.example/x">g</a><a href="mailto:a@b.c">h</a>'
          + '<a href="/%E0%A4%A">i</a>',
      }),
      'dist/about/index.html': html({ title: 'About', description: 'About page' }),
      'dist/logo.svg': '<svg/>',
    });
    const links = rulesOf(project).filter((finding) => finding.category === 'links');
    expect(links.map((finding) => [finding.ruleId, finding.evidence, finding.url])).toEqual([
      ['link-internal-broken', '/gone/', '/'],
      ['link-anchor-missing', '/about/#nope', '/'],
    ]);
  });

  it('never resolves a link outside the audited directory', () => {
    const project = site({
      'secret.txt': 'x',
      'dist/index.html': html({ title: 'Home', description: 'd', body: '<a href="/../secret.txt">x</a><a href="/%2e%2e/secret.txt">y</a>' }),
    });
    // Both normalize to /secret.txt inside dist, which does not exist: the parent's file is never consulted.
    expect(rulesOf(project).filter((finding) => finding.ruleId === 'link-internal-broken')).toHaveLength(2);
  });

  it('strips the base and leaves paths outside it alone', () => {
    const project = site({
      'dist/index.html': html({ title: 'Home', description: 'd', body: '<a href="/docs/guide/">in</a><a href="/other/">out</a><a href="/docs/gone/">gone</a>' }),
      'dist/guide/index.html': html({ title: 'Guide', description: 'g' }),
    });
    const broken = rulesOf(project, { base: '/docs' }).filter((finding) => finding.ruleId === 'link-internal-broken');
    expect(broken.map((finding) => finding.evidence)).toEqual(['/docs/gone/']);
  });

  it('flags shared titles, descriptions and canonicals once per page, ignoring noindex pages', () => {
    const shared = { title: 'Same', description: 'Same text', canonical: 'https://example.com/a/' };
    const project = site({
      'dist/a/index.html': html(shared),
      'dist/b/index.html': html(shared),
      'dist/c/index.html': html({ ...shared, head: '<meta name="robots" content="noindex">' }),
    });
    const duplicates = rulesOf(project).filter((finding) => finding.ruleId.endsWith('-duplicate'));
    expect(duplicates.map((finding) => `${finding.ruleId} ${finding.url}`).sort()).toEqual([
      'canonical-duplicate /a/', 'canonical-duplicate /b/',
      'description-duplicate /a/', 'description-duplicate /b/',
      'title-duplicate /a/', 'title-duplicate /b/',
    ]);
  });

  it('checks Markdown quality without counting fenced code as prose or residue', () => {
    const project = site({
      'dist/empty/index.html': html({ title: 'Empty', description: 'd' }),
      'dist/empty/index.md': '```html\n<div>only code</div>\n```\n',
      'dist/thin/index.html': html({ title: 'Thin', description: 'd' }),
      'dist/thin/index.md': '# Thin\n\nshort\n',
      'dist/residue/index.html': html({ title: 'Residue', description: 'd' }),
      'dist/residue/index.md': `${WORDS}\n\n<div class="x">left over</div>\n`,
      'dist/figure/index.html': html({ title: 'Figure', description: 'd' }),
      'dist/figure/index.md': `# Figure\n\n${WORDS}\n\n<figure><img src="/a.png" alt="A"></figure>\n`,
      'dist/styled/index.html': html({ title: 'Styled', description: 'd' }),
      'dist/styled/index.md': `# Styled\n\n${WORDS}\n\n<table class="min-w-full"><tr><td>1</td></tr></table>\n`,
      'dist/table/index.html': html({ title: 'Table', description: 'd' }),
      'dist/table/index.md': `# Table\n\n${WORDS}\n\n<table><tr><td colspan="2">1</td></tr></table>\n`,
      'dist/good/index.html': html({ title: 'Good', description: 'd' }),
      'dist/good/index.md': `# Good\n\n${WORDS}\n\n\`\`\`html\n<div>example</div>\n\`\`\`\n`,
    });
    const markdown = rulesOf(project)
      .filter((finding) => finding.ruleId.startsWith('markdown-'))
      .map((finding) => `${finding.ruleId} ${finding.url}`)
      .sort();
    expect(markdown).toEqual([
      'markdown-empty /empty/',
      'markdown-html-residue /figure/',
      'markdown-html-residue /residue/',
      'markdown-html-residue /styled/',
      'markdown-no-h1 /residue/',
      'markdown-thin /thin/',
    ]);
  });

  it('validates JSON-LD through the schema graph validator', () => {
    const project = site({
      'dist/index.html': html({
        title: 'Home',
        description: 'd',
        head: '<script type="application/ld+json">{not json</script>'
          + '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Person","@id":"javascript:alert(1)"},{"@type":"Person","@id":"https://example.com/#me","name":"Me"}]}</script>'
          + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","author":{"@id":"https://example.com/#elsewhere"}}</script>',
      }),
    });
    const structured = rulesOf(project).filter((finding) => finding.category === 'structured-data');
    expect(structured.map((finding) => finding.ruleId).sort()).toEqual(['authored-jsonld-malformed', 'schema.invalid-graph']);
    expect(structured.every((finding) => finding.file === '/index.html')).toBe(true);
  });

  it('checks hreflang targets and return links, and counts languages', () => {
    const project = site({
      'dist/index.html': html({ title: 'Home', description: 'en', head: '<link rel="alternate" hreflang="de" href="/de/"><link rel="alternate" hreflang="fr" href="/fr/">' }),
      'dist/de/index.html': html({ title: 'Start', description: 'de', lang: 'de' }),
    });
    const result = auditDist(join(project, 'dist'));
    expect(result.languageCount).toBe(2);
    expect(result.findings.filter((finding) => finding.category === 'internationalization').map((finding) => `${finding.ruleId} ${finding.evidence}`).sort())
      .toEqual(['hreflang-return-missing /de/', 'hreflang-target-missing /fr/']);
  });

  it('reads the sanitized private manifests and never reports an absolute path', () => {
    const project = site({
      'dist/index.html': html({ title: 'Home', description: 'd' }),
      '.astro/aeo-cache/diagnostics-v1.json': JSON.stringify({
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        pages: [{ pathname: '/', diagnostics: [{ version: 1, code: 'mdx-parse-failed', severity: 'warning', message: 'm', pathname: '/', sourcePath: '/Users/someone/site/src/pages/index.mdx', details: { body: 'SECRET' } }] }],
        diagnostics: [{ version: 1, code: 'catalog-load-failed', severity: 'warning', message: 'c', sourcePath: 'src/catalog.js' }],
      }),
    });
    const result = auditDist(join(project, 'dist'));
    const serialized = serializeAuditReport(createAuditReport({ toolVersion: 't', target: { kind: 'dist', value: 'dist' }, ...result }));
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(['mdx-parse-failed', 'catalog-load-failed']));
    expect(serialized).toContain('src/catalog.js');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('/Users/someone');
    expect(serialized).not.toContain(project);
  });

  it('skips symlinks and redirect stubs', () => {
    const project = site({
      'outside/index.html': html({ title: 'Outside', description: '' }),
      'dist/index.html': html({ title: 'Home', description: 'd' }),
      'dist/old/index.html': '<!doctype html><title>Redirecting to: /</title><meta http-equiv="refresh" content="0;url=/">',
    });
    symlinkSync(join(project, 'outside'), join(project, 'dist', 'linked'));
    expect(auditDist(join(project, 'dist')).pagesChecked).toBe(1);
  });

  it('produces identical bytes on a second run', () => {
    const run = () => serializeAuditReport(createAuditReport({
      toolVersion: 't', target: { kind: 'dist', value: 'd' }, ...auditDist('fixtures/dist-broken'),
    }));
    expect(run()).toBe(run());
  });
});
