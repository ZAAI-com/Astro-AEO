import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, describe, beforeAll } from 'vitest';
import { parseDocument } from '../html-document.js';
import { extractMarkdown } from './index.js';
import { createTurndown, DEFAULT_EXTRACTION } from '../html-to-md.js';

// Markup copied from live pages (zaai.com, powerbeat.ai) that used to reach the
// Markdown as raw, class-laden HTML. The snapshots show converter drift exactly.
const dir = fileURLToPath(new URL('../../../fixtures/extract-real/', import.meta.url));
const fixtures = readdirSync(dir).filter((file) => file.endsWith('.html')).sort();

let td;
beforeAll(async () => {
  td = await createTurndown();
});

describe('real-page markup', () => {
  test.each(fixtures)('%s', async (file) => {
    const html = `<!doctype html><html><body>${readFileSync(dir + file, 'utf8')}</body></html>`;
    const { markdown } = extractMarkdown(parseDocument(html), DEFAULT_EXTRACTION, td, {
      baseUrl: 'https://example.com/page/',
    });
    expect(markdown).not.toMatch(/class=|data-|style=|<div|<span|<figure|<dl/);
    await expect(markdown).toMatchFileSnapshot(`../../../fixtures/extract-real/${file.replace('.html', '.md')}`);
  });
});
