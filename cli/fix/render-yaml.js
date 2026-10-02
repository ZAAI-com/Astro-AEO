// @ts-check
import { FixRefusal, MARKDOWN_MIME } from './shared.js';

export const RENDER_PATH = '/*.md';
export const RENDER_PATHS = Object.freeze([RENDER_PATH, '/**/*.md']);

/**
 * Cover root and nested Markdown in a static service in `render.yaml`. The `yaml`
 * Document API edits the tree in place, so comments, anchors and key order
 * survive. It is loaded on demand: this command is its only user, and it must
 * never reach a runtime bundle.
 *
 * @param {string} text
 * @param {{ service?: string }} [options]
 * @returns {Promise<import('./shared.js').FixResult>}
 */
export async function fixRenderYaml(text, options = {}) {
  const { isMap, isSeq, parseAllDocuments } = await import('yaml');
  const documents = parseAllDocuments(text);
  if (documents.length !== 1) throw new FixRefusal('render.yaml must contain exactly one YAML document');
  const document = documents[0];
  if (document.errors.length > 0) throw new FixRefusal(`render.yaml does not parse: ${document.errors[0].message}`);
  const services = document.get('services');
  if (!isSeq(services)) throw new FixRefusal('render.yaml has no "services" list');

  const candidates = services.items.filter((item) =>
    isMap(item) && (item.get('runtime') === 'static' || item.get('env') === 'static' || item.get('type') === 'static'));
  const named = options.service
    ? candidates.filter((item) => isMap(item) && item.get('name') === options.service)
    : candidates;
  if (named.length === 0) {
    throw new FixRefusal(options.service
      ? `render.yaml has no static site service named "${options.service}"`
      : 'render.yaml has no static site service');
  }
  if (named.length > 1) {
    const names = named.map((item) => (isMap(item) ? String(item.get('name')) : '?')).join(', ');
    throw new FixRefusal(`render.yaml has several static site services (${names}); choose one with --service`);
  }
  const service = /** @type {import('yaml').YAMLMap} */ (named[0]);
  const headers = service.get('headers');
  if (headers !== undefined && !isSeq(headers)) throw new FixRefusal('the service "headers" value is not a list');

  // Validate every path before editing: ambiguity in either rule refuses the
  // whole file, including when the other rule would be safe to repair.
  const rules = RENDER_PATHS.map((path) => {
    const existing = (isSeq(headers) ? headers.items : []).filter((item) =>
      isMap(item) && item.get('path') === path && String(item.get('name')).toLowerCase() === 'content-type');
    if (existing.length > 1) throw new FixRefusal(`render.yaml sets Content-Type for ${path} more than once; merge them by hand`);
    return { path, entry: /** @type {import('yaml').YAMLMap | undefined} */ (existing[0]) };
  });
  if (rules.every(({ entry }) => entry?.get('value') === MARKDOWN_MIME)) return { status: 'unchanged', text };
  const additions = [];
  for (const { path, entry } of rules) {
    if (entry) entry.set('value', MARKDOWN_MIME);
    else additions.push({ path, name: 'Content-Type', value: MARKDOWN_MIME });
  }
  if (isSeq(headers)) for (const rule of additions) headers.add(document.createNode(rule));
  else service.set('headers', document.createNode(additions));
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const serialized = document.toString({ lineWidth: 0 });
  return { status: 'changed', text: newline === '\n' ? serialized : serialized.replace(/\r?\n/g, newline) };
}
