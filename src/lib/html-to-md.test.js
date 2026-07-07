import { test, expect, describe } from 'vitest';
import { htmlToMarkdown } from './html-to-md.js';

describe('htmlToMarkdown', () => {
  test('prefers <main> and drops nav/footer/script', () => {
    const html = `
      <html><body>
        <nav>Skip me</nav>
        <main><h1>Title</h1><p>Body text.</p><script>evil()</script></main>
        <footer>Also skip</footer>
      </body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('Body text.');
    expect(md).not.toContain('Skip me');
    expect(md).not.toContain('Also skip');
    expect(md).not.toContain('evil()');
  });

  test('falls back to whole document without <main>', () => {
    const md = htmlToMarkdown('<body><h2>Heading</h2></body>');
    expect(md).toContain('## Heading');
  });

  test('atx headings and dash bullets', () => {
    const md = htmlToMarkdown('<main><h3>H</h3><ul><li>one</li><li>two</li></ul></main>');
    expect(md).toContain('### H');
    expect(md).toMatch(/-\s+one/);
    expect(md).toMatch(/-\s+two/);
  });
});
