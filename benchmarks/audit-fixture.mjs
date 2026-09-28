// @ts-check
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORDS = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');

/**
 * Generate a synthetic built site for the audit benchmark. Deterministic: the same
 * count always yields the same bytes. Every page links to its neighbors and to one
 * anchor, every tenth page shares a title, and every hundredth has a broken link,
 * so the link, anchor and duplicate maps all do real work.
 *
 * @param {string} root Empty directory to fill.
 * @param {number} count
 */
export function generateAuditFixture(root, count) {
  const entries = [];
  for (let index = 0; index < count; index++) {
    const slug = `page-${String(index).padStart(5, '0')}`;
    const directory = join(root, 'section', String(index % 100), slug);
    mkdirSync(directory, { recursive: true });
    const href = (/** @type {number} */ target) =>
      `/section/${((target + count) % count) % 100}/page-${String((target + count) % count).padStart(5, '0')}/`;
    const title = index % 10 === 0 ? 'A Deliberately Shared Benchmark Page Title' : `Benchmark Page Number ${index} of the Synthetic Site`;
    const links = [href(index - 1), `${href(index + 1)}#top`, ...(index % 100 === 0 ? ['/missing/'] : [])]
      .map((target) => `<a href="${target}">link</a>`).join('');
    writeFileSync(join(directory, 'index.html'),
      `<!doctype html><html lang="en"><head><title>${title}</title>` +
      `<meta name="description" content="Synthetic page ${index}."><meta name="robots" content="index,follow">` +
      `<link rel="alternate" type="text/markdown" href="/section/${index % 100}/${slug}.md"></head>` +
      `<body><main><h1 id="top">${title}</h1><p>${WORDS}</p>${links}</main></body></html>`);
    writeFileSync(join(root, 'section', String(index % 100), `${slug}.md`), `# ${title}\n\n${WORDS}\n`);
    entries.push(`- [${title}](/section/${index % 100}/${slug}.md)`);
  }
  writeFileSync(join(root, 'llms.txt'), `# Benchmark\n\n## Pages\n\n${entries.join('\n')}\n`);
}
