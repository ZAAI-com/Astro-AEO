// @ts-check
import { createProcessor } from '@mdx-js/mdx';

const SAFE_ELEMENT = /^[a-z][a-z0-9-]*$/;
const NEVER_ELEMENTS = new Set(['script', 'style', 'iframe', 'object', 'embed']);

/** @param {string} code @param {string} message */
const diagnostic = (code, message) => ({ code, severity: 'warning', message });

export default {
  name: 'astro-aeo/mdx',
  apiVersion: 1,

  /** @param {any} input */
  render(input) {
    if (input.source?.kind !== 'mdx' || typeof input.source.body !== 'string') {
      return { status: 'decline' };
    }

    let components;
    try {
      components = componentMappings(input.options);
    } catch {
      return {
        status: 'continue',
        diagnostics: [diagnostic(
          'mdx-invalid-component-mapping',
          'The MDX renderer component mappings are invalid.',
        )],
      };
    }

    const source = input.source.body;
    let tree;
    try {
      // Parsing is the security boundary. Never compile, run, evaluate, or
      // import the ESM represented by this syntax tree.
      tree = createProcessor({ format: 'mdx' }).parse(source);
    } catch {
      return {
        status: 'continue',
        diagnostics: [diagnostic(
          'mdx-parse-failed',
          'The authored MDX could not be parsed; rendered HTML extraction was retained.',
        )],
      };
    }

    /** @type {{ start: number; end: number; value: string }[]} */
    const edits = [];
    const unsupported = visit(tree, source, components, edits);
    if (unsupported) {
      return {
        status: 'fallback-to-html',
        diagnostics: [diagnostic(
          'mdx-rendered-html-fallback',
          `${unsupported}; the already-rendered HTML was used without evaluating MDX.`,
        )],
      };
    }

    return {
      status: 'rendered',
      markdown: applyEdits(source, edits),
    };
  },
};

/**
 * @param {any} node
 * @param {string} source
 * @param {Record<string, any>} components
 * @param {{ start: number; end: number; value: string }[]} edits
 * @returns {string | null}
 */
function visit(node, source, components, edits) {
  if (!node || typeof node !== 'object') return null;
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (node.type === 'mdxjsEsm') {
    if (Number.isInteger(start) && Number.isInteger(end)) edits.push({ start, end, value: '' });
    return null;
  }

  if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return 'MDX contains an expression without a stable source range';
    }
    if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value ?? '')) {
      edits.push({ start, end, value: '' });
      return null;
    }
    return 'MDX contains a JavaScript expression that cannot be represented without evaluation';
  }

  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return 'MDX contains JSX without a stable source range';
    }
    const name = typeof node.name === 'string' ? node.name : null;
    if (name !== null && NEVER_ELEMENTS.has(name)) {
      edits.push({ start, end, value: '' });
      return null;
    }
    if (!literalAttributes(node.attributes ?? [])) {
      return `MDX component ${displayName(node.name)} contains an expression attribute`;
    }

    const mapping = name === null ? { action: 'unwrap' } : components[name];
    const custom = name !== null && !SAFE_ELEMENT.test(name);
    if (custom && !mapping) {
      return `MDX component ${displayName(name)} has no JSON component mapping`;
    }

    if (mapping?.action === 'omit') {
      edits.push({ start, end, value: '' });
      return null;
    }

    if (mapping?.action === 'unwrap') {
      const wrapper = wrapperEdits(source, start, end, node.children ?? [], '');
      if (!wrapper) return `MDX component ${displayName(name)} has unsupported JSX syntax`;
      edits.push(...wrapper);
    } else if (mapping?.action === 'element') {
      const wrapper = wrapperEdits(source, start, end, node.children ?? [], mapping.name);
      if (!wrapper) return `MDX component ${displayName(name)} has unsupported JSX syntax`;
      edits.push(...wrapper);
    }
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    const unsupported = visit(child, source, components, edits);
    if (unsupported) return unsupported;
  }
  return null;
}

/** @param {any[]} attributes */
function literalAttributes(attributes) {
  return attributes.every((attribute) =>
    attribute?.type === 'mdxJsxAttribute' &&
    (attribute.value === null || attribute.value === undefined || typeof attribute.value === 'string'),
  );
}

/**
 * Replace or remove only the outer JSX tokens, retaining authored Markdown
 * children byte-for-byte. An empty element becomes an explicit empty mapped
 * element, or disappears when unwrapped.
 * @param {string} source
 * @param {number} start
 * @param {number} end
 * @param {any[]} children
 * @param {string} replacementName Empty means unwrap.
 */
function wrapperEdits(source, start, end, children, replacementName) {
  const fragment = source.slice(start, end);
  const openingEnd = tagEnd(fragment);
  if (openingEnd === -1) return null;
  const opening = fragment.slice(0, openingEnd + 1);
  const selfClosing = /\/\s*>$/.test(opening);
  if (selfClosing) {
    return [{
      start,
      end,
      value: replacementName ? `<${replacementName}></${replacementName}>` : '',
    }];
  }

  const closingStart = fragment.lastIndexOf('</');
  if (closingStart < openingEnd) return null;
  const openingValue = replacementName ? `<${replacementName}>` : '';
  const closingValue = replacementName ? `</${replacementName}>` : '';
  return [
    { start, end: start + openingEnd + 1, value: openingValue },
    { start: start + closingStart, end, value: closingValue },
  ];
}

/** @param {string} value */
function tagEnd(value) {
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

/** @param {unknown} options */
function componentMappings(options) {
  if (options === undefined || options === null) return Object.create(null);
  if (!isPlainObject(options)) throw new TypeError('options must be an object');
  const configured = options.components;
  if (configured === undefined) return Object.create(null);
  if (!isPlainObject(configured)) throw new TypeError('components must be an object');
  /** @type {Record<string, any>} */
  const mappings = Object.create(null);
  for (const [component, mapping] of Object.entries(configured)) {
    if (!component) throw new TypeError('component names must not be empty');
    if (!isPlainObject(mapping)) throw new TypeError(`${component} must use an object mapping`);
    if (mapping.action === 'unwrap' || mapping.action === 'omit') {
      if (Object.keys(mapping).some((key) => key !== 'action')) {
        throw new TypeError(`${component} has unknown mapping keys`);
      }
      mappings[component] = { action: mapping.action };
      continue;
    }
    if (
      mapping.action === 'element' &&
      typeof mapping.name === 'string' &&
      SAFE_ELEMENT.test(mapping.name) &&
      !NEVER_ELEMENTS.has(mapping.name) &&
      Object.keys(mapping).every((key) => key === 'action' || key === 'name')
    ) {
      mappings[component] = { action: 'element', name: mapping.name };
      continue;
    }
    throw new TypeError(`${component} must be unwrap, omit, or a safe element mapping`);
  }
  return mappings;
}

/** @param {string} source @param {{ start: number; end: number; value: string }[]} edits */
function applyEdits(source, edits) {
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
  }
  return output;
}

/** @param {unknown} value */
function displayName(value) {
  return typeof value === 'string' && value ? `<${value}>` : 'an MDX fragment';
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
