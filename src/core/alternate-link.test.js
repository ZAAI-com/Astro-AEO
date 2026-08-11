import { describe, expect, test } from 'vitest';
import { withMarkdownAlternateLink } from './alternate-link.js';

describe('withMarkdownAlternateLink', () => {
  test('inserts replacement-string metacharacters as literal URL bytes', () => {
    const html = '<html><head><title>T</title></head><body>Body</body></html>';
    for (const [href, escapedHref] of [
      ['/a$&b.md', '/a$&amp;b.md'],
      ["/a$'b.md", "/a$'b.md"],
      ['/a$`b.md', '/a$`b.md'],
    ]) {
      const result = withMarkdownAlternateLink(html, href, 'auto');
      expect(result).toContain(`href="${escapedHref}">`);
      expect(result).toContain('</head><body>Body</body>');
    }
  });

  test('safely replaces an authored alternate in always mode', () => {
    const html =
      '<html><head><link rel="alternate" type="text/markdown" href="/old.md"></head><body>Body</body></html>';
    const result = withMarkdownAlternateLink(html, "/a$'b.md", 'always');
    expect(result).toContain('href="/a$\'b.md"');
    expect(result).toContain('</head><body>Body</body>');
    expect(result).not.toContain('/old.md');
  });

  test('does not treat tag-like script text as an authored alternate or head boundary', () => {
    const script = '<script>const tags = `<link rel="alternate" type="text/markdown" href="/literal.md"></head>`;</script>';
    const html = `<html><head>${script}</head><body>Body</body></html>`;
    const result = withMarkdownAlternateLink(html, '/real.md', 'auto');
    expect(result).toContain(script);
    expect(result.match(/href="\/real\.md"/g)).toHaveLength(1);
    expect(result.indexOf('/real.md')).toBeGreaterThan(result.indexOf('</script>'));
  });
});
