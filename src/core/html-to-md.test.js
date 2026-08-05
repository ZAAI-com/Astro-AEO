import { test, expect, describe, vi } from 'vitest';
import { createTurndownLoader, htmlToMarkdown } from './html-to-md.js';

const own = (key) => Object.prototype.hasOwnProperty.call(globalThis, key);
const snapshotGlobal = (key) => ({ own: own(key), value: globalThis[key] });
const restoreGlobal = (key, snapshot) => {
  if (snapshot.own) globalThis[key] = snapshot.value;
  else Reflect.deleteProperty(globalThis, key);
};

describe('lazy Turndown initialization', () => {
  test('shares one import across concurrent callers and restores the shim', async () => {
    const parser = snapshotGlobal('DOMParser');
    const window = snapshotGlobal('window');
    Reflect.deleteProperty(globalThis, 'DOMParser');
    Reflect.deleteProperty(globalThis, 'window');

    let release;
    const waiting = new Promise((resolve) => (release = resolve));
    const Service = function TurndownService() {};
    const importer = vi.fn(async () => {
      expect(typeof globalThis.DOMParser).toBe('function');
      expect(globalThis.window).toBe(globalThis);
      await waiting;
      return { default: Service };
    });
    const load = createTurndownLoader(importer);

    try {
      const first = load();
      const second = load();
      expect(second).toBe(first);
      expect(importer).toHaveBeenCalledTimes(1);
      release();
      expect(await first).toBe(Service);
      expect(await second).toBe(Service);
      expect(own('DOMParser')).toBe(false);
      expect(own('window')).toBe(false);
    } finally {
      restoreGlobal('DOMParser', parser);
      restoreGlobal('window', window);
    }
  });

  test('does not replace a host DOMParser', async () => {
    const parser = snapshotGlobal('DOMParser');
    const window = snapshotGlobal('window');
    class NativeDOMParser {
      parseFromString() {
        return {};
      }
    }
    globalThis.DOMParser = NativeDOMParser;
    Reflect.deleteProperty(globalThis, 'window');

    const Service = function TurndownService() {};
    const load = createTurndownLoader(async () => {
      expect(globalThis.DOMParser).toBe(NativeDOMParser);
      expect(globalThis.window.DOMParser).toBe(NativeDOMParser);
      return { default: Service };
    });

    try {
      expect(await load()).toBe(Service);
      expect(globalThis.DOMParser).toBe(NativeDOMParser);
      expect(own('window')).toBe(false);
    } finally {
      restoreGlobal('DOMParser', parser);
      restoreGlobal('window', window);
    }
  });

  test('cleans up after a failed import and permits a retry', async () => {
    const parser = snapshotGlobal('DOMParser');
    const window = snapshotGlobal('window');
    Reflect.deleteProperty(globalThis, 'DOMParser');
    Reflect.deleteProperty(globalThis, 'window');

    const Service = function TurndownService() {};
    let attempts = 0;
    const load = createTurndownLoader(async () => {
      attempts++;
      expect(typeof globalThis.DOMParser).toBe('function');
      if (attempts === 1) throw new Error('module unavailable');
      return { default: Service };
    });

    try {
      await expect(load()).rejects.toThrow('module unavailable');
      expect(own('DOMParser')).toBe(false);
      expect(own('window')).toBe(false);
      expect(await load()).toBe(Service);
      expect(attempts).toBe(2);
    } finally {
      restoreGlobal('DOMParser', parser);
      restoreGlobal('window', window);
    }
  });
});

describe('htmlToMarkdown', () => {
  test('prefers <main> and drops nav/footer/script', async () => {
    const html = `
      <html><body>
        <nav>Skip me</nav>
        <main><h1>Title</h1><p>Body text.</p><script>evil()</script></main>
        <footer>Also skip</footer>
      </body></html>`;
    const md = await htmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('Body text.');
    expect(md).not.toContain('Skip me');
    expect(md).not.toContain('Also skip');
    expect(md).not.toContain('evil()');
  });

  test('falls back to whole document without <main>', async () => {
    const md = await htmlToMarkdown('<body><h2>Heading</h2></body>');
    expect(md).toContain('## Heading');
  });

  test('atx headings and dash bullets', async () => {
    const md = await htmlToMarkdown('<main><h3>H</h3><ul><li>one</li><li>two</li></ul></main>');
    expect(md).toContain('### H');
    expect(md).toMatch(/-\s+one/);
    expect(md).toMatch(/-\s+two/);
  });
});
