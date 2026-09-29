import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    const optionsFile = `${dir}${file.replace('.html', '.options.json')}`;
    const overrides = existsSync(optionsFile) ? JSON.parse(readFileSync(optionsFile, 'utf8')) : {};
    const { markdown } = extractMarkdown(parseDocument(html), { ...DEFAULT_EXTRACTION, ...overrides }, td, {
      baseUrl: 'https://example.com/page/',
    });
    // Fenced code can legitimately quote HTML; only leakage outside fences counts.
    // A fence closes on the same character repeated at least as many times.
    const unfenced = markdown.replace(/^ {0,3}(([`~])\2{2,})[^\n]*\n[\s\S]*?^ {0,3}\1\2*[ \t]*$/gm, '');
    expect(unfenced).not.toMatch(/class=|data-|style=|<div|<span|<figure|<dl/);
    await expect(markdown).toMatchFileSnapshot(`../../../fixtures/extract-real/${file.replace('.html', '.md')}`);
  });
});
