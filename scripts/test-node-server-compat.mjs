#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO,
  buildAdapter,
  fixture,
  startProcess,
  stopProcess,
  waitForReady,
} from '../test/adapters/helpers.js';

const astro = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const nodeAdapter = JSON.parse(
  readFileSync(join(REPO, 'node_modules/@astrojs/node/package.json'), 'utf8'),
);
if (process.env.ASTRO_AEO_EXPECT_ASTRO) {
  assert.equal(astro.version, process.env.ASTRO_AEO_EXPECT_ASTRO, 'pinned Astro version');
}
if (process.env.ASTRO_AEO_EXPECT_NODE_ADAPTER) {
  assert.equal(
    nodeAdapter.version,
    process.env.ASTRO_AEO_EXPECT_NODE_ADAPTER,
    'pinned @astrojs/node version',
  );
}
if (process.env.ASTRO_AEO_EXPECT_NODE) {
  const expected = process.env.ASTRO_AEO_EXPECT_NODE;
  assert.ok(
    process.versions.node === expected || process.versions.node.startsWith(`${expected}.`),
    `expected Node ${expected}, received ${process.versions.node}`,
  );
}
const modes = process.argv.includes('--trailing-matrix')
  ? ['always', 'never', 'ignore']
  : [process.env.ASTRO_AEO_TRAILING_SLASH ?? 'ignore'];
const [major, minor] = astro.version.split('.').map(Number);
const liveCorpusSupported = major > 6 || (major === 6 && minor >= 3);

for (const [index, trailingSlash] of modes.entries()) {
  const port = 4590 + index;
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/docs`;
  process.env.ASTRO_AEO_TRAILING_SLASH = trailingSlash;
  process.env.ASTRO_AEO_SCHEMA_CORPUS = '1';

  let server;
  try {
    buildAdapter('node');
    server = startProcess(process.execPath, [join(fixture('node'), 'dist/server/entry.mjs')], {
      env: { HOST: '127.0.0.1', PORT: String(port) },
    });
    await waitForReady(base, server);

    const canonical = `https://adapter.example.com/docs/about${trailingSlash === 'never' ? '' : '/'}`;
    const htmlPath = trailingSlash === 'never' ? '/about' : '/about/';
    const html = await fetch(`${base}${htmlPath}`);
    assert.equal(html.status, 200, `${trailingSlash}: HTML route status`);
    const htmlBody = await html.text();
    assert.match(htmlBody, /data-astro-aeo-graph/, `${trailingSlash}: managed graph`);
    assert.ok(htmlBody.includes(`${canonical}#webpage`), `${trailingSlash}: canonical graph id`);

    const markdown = await fetch(`${base}/about.md?value=compat`);
    assert.equal(markdown.status, 200, `${trailingSlash}: direct Markdown status`);
    assert.match(markdown.headers.get('content-type') ?? '', /text\/markdown/);
    assert.equal(markdown.headers.get('link'), `<${canonical}>; rel="canonical"`);
    assert.ok((await markdown.text()).includes('QUERY-compat'), `${trailingSlash}: query preserved`);

    const catalogMarkdown = await fetch(`${base}/catalog-dynamic.md`);
    assert.equal(catalogMarkdown.status, 200, `${trailingSlash}: catalog Markdown status`);
    assert.ok(
      (await catalogMarkdown.text()).includes('Exact adapter catalog source.'),
      `${trailingSlash}: catalog Markdown source`,
    );

    const redirect = await fetch(`${base}/old.md`, { redirect: 'manual' });
    assert.equal(redirect.status, 302, `${trailingSlash}: redirect status`);
    assert.equal(redirect.headers.get('location'), '/docs/about.md?from=old');

    for (const pathname of [
      '/llms.txt',
      '/llms-full.txt',
      '/schema/graph.jsonld',
      '/schema/schema-map.xml',
    ]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(
        response.status,
        liveCorpusSupported ? 200 : 503,
        `${trailingSlash}: ${pathname} Astro ${astro.version}`,
      );
      assert.equal(
        response.headers.get('cache-control'),
        liveCorpusSupported ? null : 'no-store',
        `${trailingSlash}: ${pathname} cache policy`,
      );
      const body = await response.text();
      if (liveCorpusSupported && pathname.startsWith('/llms')) {
        assert.ok(body.includes('Catalog Dynamic'), `${trailingSlash}: catalog in ${pathname}`);
      }
      if (liveCorpusSupported && pathname === '/schema/graph.jsonld') {
        assert.match(body, /"@context":"https:\/\/schema\.org"/);
        assert.ok(body.includes(canonical), `${trailingSlash}: canonical in schema corpus`);
      }
      if (liveCorpusSupported && pathname === '/schema/schema-map.xml') {
        assert.match(body, /https:\/\/zaai\.com\/astro-aeo\/schema-map\/1/);
        assert.ok(body.includes(canonical), `${trailingSlash}: canonical in schema map`);
      }
      if (!liveCorpusSupported) {
        assert.match(body, /require Astro 6\.3 or newer/);
      }
    }

    console.log(
      `Astro ${astro.version}, @astrojs/node ${nodeAdapter.version}, Node ${process.version}, trailingSlash ${trailingSlash}: passed`,
    );
  } finally {
    await stopProcess(server?.child);
  }
}
