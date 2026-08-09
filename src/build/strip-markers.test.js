import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { stripSourceMarkers } from './strip-markers.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const marked =
  '<html><body><main>Public</main><script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>{"markdown":"# Private"}</script></body></html>';

describe('stripSourceMarkers', () => {
  test('rewrites a file-format page whose Astro page name has a trailing slash', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-strip-file-'));
    roots.push(root);
    writeFileSync(join(root, 'about.html'), marked);

    const stripped = stripSourceMarkers(
      [{ pathname: 'about/' }],
      createDistHtmlSource({ distDir: pathToFileURL(`${root}/`), buildFormat: 'file' }),
    );

    expect(stripped).toBe(1);
    expect(readFileSync(join(root, 'about.html'), 'utf8')).toBe(
      '<html><body><main>Public</main></body></html>',
    );
  });

  test('rewrites flat status files in a directory-format build', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-strip-status-'));
    roots.push(root);
    writeFileSync(join(root, '404.html'), marked);
    writeFileSync(join(root, '500.html'), marked);

    const stripped = stripSourceMarkers(
      [{ pathname: '404/' }, { pathname: '/500/' }],
      createDistHtmlSource({ distDir: pathToFileURL(`${root}/`), buildFormat: 'directory' }),
    );

    expect(stripped).toBe(2);
    expect(readFileSync(join(root, '404.html'), 'utf8')).not.toContain('data-astro-aeo-marker');
    expect(readFileSync(join(root, '500.html'), 'utf8')).not.toContain('data-astro-aeo-marker');
  });

  test('ignores unreadable pages and pages without markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-strip-none-'));
    roots.push(root);
    mkdirSync(join(root, 'plain'), { recursive: true });
    writeFileSync(join(root, 'plain', 'index.html'), '<html><body>Plain</body></html>');

    const stripped = stripSourceMarkers(
      [{ pathname: '/missing' }, { pathname: '/plain' }],
      createDistHtmlSource({ distDir: pathToFileURL(`${root}/`), buildFormat: 'directory' }),
    );

    expect(stripped).toBe(0);
  });
});
