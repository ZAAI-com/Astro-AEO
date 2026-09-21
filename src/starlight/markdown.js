// @ts-check

/**
 * Turn Starlight-flavored Markdown or MDX source into portable Markdown. Asides
 * and tabs become labeled sections, so their content survives without the
 * components. Anything this module cannot represent faithfully (an arbitrary
 * component, a JavaScript expression) returns `null`, and the caller falls back
 * to extracting the rendered page. Nothing is evaluated.
 */

const ASIDE_LABELS = Object.freeze({ note: 'Note', tip: 'Tip', caution: 'Caution', danger: 'Danger' });
const FENCE = /^(\s*)(`{3,}|~{3,})/;

/**
 * @param {string} source
 * @param {{ mdx?: boolean }} [options]
 * @returns {{ markdown: string } | { fallback: 'dynamic-mdx' }}
 */
export function starlightMarkdown(source, options = {}) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  /** @type {string[]} */
  const output = [];
  /** @type {string | null} */
  let fence = null;
  /** @type {{ quote: boolean }[]} */
  const asides = [];
  let head = options.mdx === true;

  for (const raw of lines) {
    const fenceMatch = FENCE.exec(raw);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[2].startsWith(fence) && raw.trim() === fenceMatch[2]) fence = null;
      output.push(quote(raw, asides.length));
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[2];
      head = false;
      output.push(quote(raw, asides.length));
      continue;
    }

    let line = raw;
    if (head) {
      // An import carries no content. An export defines a value the page may render, and a
      // multi-line import is rare in docs: both fall back instead of being guessed at.
      if (/^\s*export\s/.test(line)) return { fallback: 'dynamic-mdx' };
      if (/^\s*import\s/.test(line)) {
        if (/[{(,]\s*$/.test(line)) return { fallback: 'dynamic-mdx' };
        continue;
      }
      if (line.trim() !== '') head = false;
    }

    const open = /^\s*:::(note|tip|caution|danger)(?:\[(.*)\])?\s*$/.exec(line);
    if (open) {
      const label = ASIDE_LABELS[/** @type {keyof typeof ASIDE_LABELS} */ (open[1])];
      output.push(quote(`**${open[2] ? `${label}: ${open[2]}` : label}**`, asides.length + 1), quote('', asides.length + 1));
      asides.push({ quote: true });
      continue;
    }
    if (/^\s*:::\s*$/.test(line) && asides.length > 0) {
      asides.pop();
      output.push('');
      continue;
    }

    if (options.mdx) {
      const converted = convertComponents(line);
      if (converted === null) return { fallback: 'dynamic-mdx' };
      if (converted.open) {
        output.push(quote(converted.text, asides.length + 1), quote('', asides.length + 1));
        asides.push({ quote: true });
        continue;
      }
      if (converted.close) {
        if (asides.length > 0) asides.pop();
        output.push('');
        continue;
      }
      line = converted.text;
    }
    output.push(quote(line, asides.length));
  }
  if (fence !== null || asides.length > 0) return { fallback: 'dynamic-mdx' };
  return { markdown: `${output.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n` };
}

/**
 * Starlight's own content components, line by line. Returns `null` for anything
 * else that looks like JSX or an expression.
 *
 * @param {string} line
 * @returns {{ text: string; open?: boolean; close?: boolean } | null}
 */
function convertComponents(line) {
  const trimmed = line.trim();
  // An attribute computed at run time makes even a known component dynamic.
  if (/^<[A-Z][^>]*=\{/.test(trimmed)) return null;
  if (/^<\/?(?:Tabs|Steps|CardGrid|FileTree)\b[^>]*>$/.test(trimmed)) return { text: '' };
  const tab = /^<TabItem\b([^>]*)>$/.exec(trimmed);
  if (tab) return { text: `**${attribute(tab[1], 'label') ?? 'Tab'}**` };
  if (trimmed === '</TabItem>') return { text: '' };
  const card = /^<(?:Card|LinkCard)\b([^>]*?)\/?>$/.exec(trimmed);
  if (card) {
    const title = attribute(card[1], 'title');
    const href = attribute(card[1], 'href');
    if (!title) return null;
    return { text: href ? `**[${title}](${href})**` : `**${title}**` };
  }
  if (trimmed === '</Card>') return { text: '' };
  const aside = /^<Aside\b([^>]*)>$/.exec(trimmed);
  if (aside) {
    const type = attribute(aside[1], 'type') ?? 'note';
    const label = ASIDE_LABELS[/** @type {keyof typeof ASIDE_LABELS} */ (type)] ?? 'Note';
    const title = attribute(aside[1], 'title');
    return { text: `**${title ? `${label}: ${title}` : label}**`, open: true };
  }
  if (trimmed === '</Aside>') return { text: '', close: true };
  // Any other component, or an expression outside inline code, cannot be rendered from source.
  const prose = line.replace(/`[^`]*`/g, '');
  if (/<\/?[A-Z][\w.]*[\s/>]/.test(prose) || /(^|[^\\])\{/.test(prose)) return null;
  return { text: line };
}

/** A quoted string attribute only: an expression value means the content is dynamic. @param {string} attributes @param {string} name */
function attribute(attributes, name) {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? match[1] ?? match[2] : undefined;
}

/** @param {string} line @param {number} depth */
function quote(line, depth) {
  return depth > 0 ? `${'> '.repeat(depth)}${line}`.trimEnd() : line;
}
