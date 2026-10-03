import { afterEach, expect, test } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createPageSnapshot, evidenceHash, stageBuildEvidence } from './evidence.js';
import { createArtifactWriter } from './artifacts.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const page = (pathname = '/page', text = 'Private source SECRET') => ({
  pathname, routePattern: '/[slug]', locale: 'en', version: 'v1',
  source: { body: text, hash: 'claimed', path: '/Users/private/secret', strategy: 'catalog' },
  representations: { html: '<main>Private HTML SECRET</main>', markdown: 'Private Markdown SECRET' },
  metadata: { title: 'Private title SECRET' }, entities: [], authors: [], directives: { index: true },
  diagnostics: [{ code: 'page-warning', severity: 'warning', message: 'credential SECRET', sourcePath: '/private/file' }],
});

test('snapshots use actual component hashes, canonical ordering, and no raw content or locations', () => {
  const a = page('/a');
  const b = page('/b');
  const snapshot = createPageSnapshot([b, a], [], true);
  expect(snapshot).toEqual(createPageSnapshot([a, b], [], true));
  expect(snapshot.pages[0].components.source).toBe(evidenceHash(a.source.body));
  expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|claimed|Users|credential|sourcePath/);
  expect(createPageSnapshot([page('/a', 'Edited')], [], true).buildDigest).not.toBe(snapshot.buildDigest);
  expect(createPageSnapshot([a, b], [], false).buildDigest).not.toBe(snapshot.buildDigest);
  expect(createPageSnapshot([{ ...a, pathname: 'https://user:password@host/page' }], [], true).pages).toEqual([]);
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'aeo-evidence-')); roots.push(root);
  mkdirSync(join(root, 'dist'));
  const writer = () => createArtifactWriter({ distDir: pathToFileURL(`${root}/dist/`), projectRoot: root,
    deferred: true, base: '/docs', logger: { info() {}, warn() {} } });
  const evidence = (writer, trace = [], complete = true) => stageBuildEvidence({
    projectRoot: root, pages: [page()], writer, semanticPages: [{ page: page(), graph: {
      entries: [{ entity: { '@id': 'SECRET' }, provenance: [{ source: 'authored-jsonld', pointer: '/SECRET' }] }],
    } }], inventoryComplete: complete, trace,
    diagnostics: page().diagnostics, cacheReasons: { 'key-missing': 1, 'SECRET': 8 },
  });
  const read = (name) => JSON.parse(readFileSync(join(root, '.astro', 'aeo-cache', `${name}-v1.json`), 'utf8'));
  return { root, writer, evidence, read };
}

test('private snapshots and trace share deterministic digests, redact evidence, and have mode 0600', () => {
  const { root, writer, evidence, read } = project();
  const first = writer(); first.write({ route: '/page.md', owner: 'dotmd', contents: 'Published' });
  evidence(first, [{ pathname: '/page', stage: 'normalization', outcome: 'miss' }]); first.commit();
  const snapshot = read('pages');
  const trace = read('trace');
  expect(trace.buildDigest).toBe(snapshot.buildDigest);
  expect(trace.pages[0]).toMatchObject({ graphEntities: 1, graphProvenance: { 'authored-jsonld': 1 } });
  expect(trace.artifacts).toEqual([{ pathname: '/docs/page.md', action: 'generated' }]);
  expect(JSON.stringify(trace)).not.toMatch(/SECRET|credential|private\/|sourcePath/);
  for (const name of ['pages', 'trace']) expect(lstatSync(join(root, '.astro', 'aeo-cache', `${name}-v1.json`)).mode & 0o777).toBe(0o600);
  const second = writer(); second.write({ route: '/page.md', owner: 'dotmd', contents: 'Published' });
  evidence(second, [{ pathname: '/page', stage: 'normalization', outcome: 'hit' }]); second.commit();
  expect(read('pages').buildDigest).toBe(snapshot.buildDigest);
  expect(read('trace').artifacts).toEqual([{ pathname: '/docs/page.md', action: 'preserved' }]);
});

test('identical owned output retains its mtime and cleaned output is restored with evidence', () => {
  const { root, writer, evidence, read } = project();
  const build = () => { const w = writer(); w.write({ route: '/page.md', owner: 'dotmd', contents: 'Published' }); evidence(w); w.commit(); };
  build();
  const path = join(root, 'dist', 'page.md');
  utimesSync(path, new Date('2000-01-01Z'), new Date('2000-01-01Z'));
  const before = lstatSync(path).mtimeMs;
  build(); expect(lstatSync(path).mtimeMs).toBe(before);
  rmSync(path); build();
  expect(readFileSync(path, 'utf8')).toBe('Published');
  expect(read('trace').artifacts).toEqual([{ pathname: '/docs/page.md', action: 'restored' }]);
});

test('an incomplete inventory preserves unseen owned output until a complete build', () => {
  const { root, writer, evidence, read } = project();
  let w = writer(); w.write({ route: '/old.md', owner: 'dotmd', contents: 'Old' }); evidence(w); w.commit();
  w = writer(); w.withholdStaleDeletion(); evidence(w, [], false); w.commit();
  expect(readFileSync(join(root, 'dist', 'old.md'), 'utf8')).toBe('Old');
  expect(read('trace').artifacts).toEqual([{ pathname: '/docs/old.md', action: 'preserved' }]);
  w = writer(); evidence(w); w.commit();
  expect(read('trace').artifacts).toEqual([{ pathname: '/docs/old.md', action: 'removed' }]);
  expect(() => lstatSync(join(root, 'dist', 'old.md'))).toThrow();
});

test('linked private evidence aborts the whole output transaction without following the link', () => {
  const { root, writer, evidence } = project();
  const target = join(root, 'outside.json'); writeFileSync(target, 'Keep');
  mkdirSync(join(root, '.astro', 'aeo-cache'), { recursive: true });
  symlinkSync(target, join(root, '.astro', 'aeo-cache', 'trace-v1.json'));
  const w = writer(); w.write({ route: '/page.md', owner: 'dotmd', contents: 'Published' }); evidence(w);
  expect(() => w.commit()).toThrow(/symbolic link/);
  expect(readFileSync(target, 'utf8')).toBe('Keep');
  expect(() => lstatSync(join(root, 'dist', 'page.md'))).toThrow();
});


test('RAG evidence hashes are order-independent, content-derived and content-free', () => {
  const a = {id:'a',text:'PRIVATE RAG CONTENT',metadata:{category:'a'}};
  const b = {id:'b',text:'PRIVATE RAG CONTENT',metadata:{category:'b'}};
  const snapshot = createPageSnapshot([page()],[],true,[a,b]);
  expect(snapshot).toEqual(createPageSnapshot([page()],[],true,[b,a]));
  expect(createPageSnapshot([page()],[],true,[{...a,metadata:{category:'edited'}},b]).buildDigest).not.toBe(snapshot.buildDigest);
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE RAG CONTENT');
});
