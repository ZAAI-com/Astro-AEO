// @ts-check
import { evidenceHash } from '../../src/build/evidence.js';
import { ReportInvocationError } from './io.js';

/** Extract references without fetching contexts, linked documents or remote assets.
 * @param {unknown} input @param {{type?:string;node?:string;depth?:number}} [options]
 * @returns {import('../../src/index.js').GraphReportV1} */
export function graphReport(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !Array.isArray(/** @type {any} */ (input)['@graph'])) throw new ReportInvocationError('Graph input must contain a JSON-LD @graph array.');
  /** @type {Map<string, import('../../src/index.js').GraphReportV1['nodes'][number]>} */
  const nodes = new Map();
  /** @type {import('../../src/index.js').GraphReportV1['edges']} */
  const edges = [];
  let visits = 0;
  /** @param {any} value @param {string} id @param {string} property @param {number} depth */
  const walk = (value,id,property,depth) => {
    if (++visits > 100000 || depth > 32) throw new ReportInvocationError('Graph input exceeds the traversal limit.');
    if (Array.isArray(value)) { for (const item of value) walk(item,id,property,depth+1); return; }
    if (!value || typeof value !== 'object') return;
    if (Object.keys(value).some((key) => ['__proto__','constructor','prototype'].includes(key))) throw new ReportInvocationError('Unsafe graph object.');
    if (value['@id'] !== undefined && typeof value['@id'] !== 'string' ||
      value['@type'] !== undefined && (Array.isArray(value['@type']) ? value['@type'].some((/** @type {unknown} */ entry) => typeof entry !== 'string') : typeof value['@type'] !== 'string')) throw new ReportInvocationError('Invalid graph identity or type.');
    for (const key of ['@id','url']) {
      const raw = value[key];
      if (typeof raw === 'string' && /^https?:/.test(raw)) {
        let url; try { url = new URL(raw); } catch { throw new ReportInvocationError('Invalid graph URL.'); }
        if (url.username || url.password || url.search) throw new ReportInvocationError('Graph URLs must not contain credentials or query values.');
      }
    }
    const target = typeof value['@id'] === 'string' ? value['@id'] : null;
    if (target && target !== id) {
      edges.push({from:id,to:target,property:property || '@id'});
      if (edges.length > 50000) throw new ReportInvocationError('Graph input exceeds the edge limit.');
      if (!nodes.has(target)) nodes.set(target,{id:target,label:target,types:[]});
    }
    const owner = target ?? id;
    if (value['@type'] !== undefined || value.name !== undefined || value.headline !== undefined) {
      const types = (Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).filter((/** @type {unknown} */ t) => typeof t === 'string');
      const title = typeof value.name === 'string' ? value.name : typeof value.headline === 'string' ? value.headline : owner;
      const previous = nodes.get(owner);
      nodes.set(owner,{id:owner,label:title,types:[...new Set([...(previous?.types ?? []),...types])].sort()});
    }
    if (nodes.size > 10000) throw new ReportInvocationError('Graph input exceeds the node limit.');
    for (const [key,child] of Object.entries(value)) if (!key.startsWith('@')) walk(child,owner,key,depth+1);
  };
  for (const value of /** @type {any} */ (input)['@graph']) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportInvocationError('Graph nodes must be objects.');
    const id = typeof value['@id'] === 'string' ? value['@id'] : '_:' + evidenceHash(value).slice(7);
    if (!nodes.has(id)) nodes.set(id,{id,label:id,types:[]});
    walk(value,id,'',0);
  }
  let selected = new Set([...nodes.keys()]);
  if (options.type) selected = new Set([...selected].filter((id) => nodes.get(id)?.types.includes(/** @type {string} */ (options.type))));
  if (options.node) {
    if (!nodes.has(options.node)) throw new ReportInvocationError('Requested graph node is absent.');
    let neighborhood = new Set([options.node]);
    for (let n = 0; n < (options.depth ?? 1); n++) {
      const next = new Set(neighborhood);
      for (const edge of edges) if (neighborhood.has(edge.from) || neighborhood.has(edge.to)) { next.add(edge.from); next.add(edge.to); }
      neighborhood = next;
    }
    selected = new Set([...selected].filter((id) => neighborhood.has(id)));
  }
  return {version:1,type:'graph',warnings:['JSON-LD identities and types are authored claims; remote references were not resolved.'],
    nodes:[...nodes.values()].filter((node) => selected.has(node.id)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    edges:[...new Map(edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)).map((edge) => [JSON.stringify(edge),edge])).values()]
      .sort((a,b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0) };
}
