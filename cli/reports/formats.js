// @ts-check
import { escapeXml, printable } from '../formats/shared.js';
import { cspMeta } from '../formats/csp.js';
import { serializeRagRecords } from '../../src/core/rag.js';

export const REPORT_STYLE = 'body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:inline-block;margin:.5rem}input,select{font:inherit;max-width:100%}[hidden]{display:none}';
/** No HTML or data-derived selectors. Only textContent, hidden and DOM construction.
 * The initial table is complete and usable with JavaScript disabled. */
export const GRAPH_SCRIPT = `(() => {
  const data = JSON.parse(document.getElementById('graph-data').textContent);
  const query = document.getElementById('graph-query');
  const type = document.getElementById('graph-type');
  const center = document.getElementById('graph-center');
  const depth = document.getElementById('graph-depth');
  const summary = document.getElementById('graph-count');
  for (const value of [...new Set(data.nodes.flatMap(n => n.types))].sort()) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; type.appendChild(option);
  }
  for (const node of data.nodes) {
    const option = document.createElement('option'); option.value = node.id; option.textContent = node.label + ' (' + node.id + ')'; center.appendChild(option);
  }
  function filter() {
    let neighborhood = new Set(data.nodes.map(n => n.id));
    if (center.value) {
      neighborhood = new Set([center.value]);
      for (let i = 0; i < Number(depth.value); i++) {
        const next = new Set(neighborhood);
        for (const edge of data.edges) if (neighborhood.has(edge.from) || neighborhood.has(edge.to)) { next.add(edge.from); next.add(edge.to); }
        neighborhood = next;
      }
    }
    const search = query.value.toLowerCase();
    const selected = new Set(data.nodes.filter(n => neighborhood.has(n.id) && (!type.value || n.types.includes(type.value)) &&
      (n.id + ' ' + n.label + ' ' + n.types.join(' ')).toLowerCase().includes(search)).map(n => n.id));
    document.querySelectorAll('#graph-nodes tbody tr').forEach((row, i) => { row.hidden = !selected.has(data.nodes[i].id); });
    document.querySelectorAll('#graph-edges tbody tr').forEach((row, i) => { row.hidden = !selected.has(data.edges[i].from) || !selected.has(data.edges[i].to); });
    summary.textContent = selected.size + ' visible node(s)';
  }
  for (const control of [query,type,center,depth]) control.addEventListener('input', filter);
  filter();
})();`;

/** @param {import('../../src/index.js').AeoDataReportV1} report @param {string} format */
export function renderDataReport(report, format) {
  if (format === 'json') return JSON.stringify(report,null,2) + '\n';
  if (format === 'jsonl' && report.type === 'rag') return serializeRagRecords(report.records);
  const heading = 'Astro-AEO ' + report.type;
  const rows = reportRows(report);
  if (format === 'html') {
    if (report.type === 'graph') return graphHtml(report);
    const table = '<table><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>' +
      rows.map(([label,value]) => '<tr><td>' + escapeXml(label) + '</td><td><pre>' + escapeXml(value) + '</pre></td></tr>').join('\n') + '</tbody></table>';
    return documentHtml(heading,warningHtml(report.warnings) + table);
  }
  if (format === 'markdown') {
    const escape = (/** @type {string} */ value) => escapeXml(printable(value)).replaceAll('|','&#124;').replaceAll('`','&#96;').replaceAll('\\','&#92;');
    return '# ' + heading + '\n\n' + report.warnings.map((warning) => '> ' + escape(warning)).join('\n') +
      '\n\n| Item | Evidence |\n| --- | --- |\n' + rows.map(([a,b]) => '| ' + escape(a) + ' | ' + escape(b) + ' |').join('\n') + '\n';
  }
  return heading + '\n' + report.warnings.map((warning) => 'warning: ' + printable(warning)).join('\n') + '\n' +
    rows.map(([a,b]) => printable(a) + ': ' + printable(b)).join('\n') + '\n';
}
/** @param {import('../../src/index.js').AeoDataReportV1} report @returns {string[][]} */
function reportRows(report) {
  if (report.type === 'traffic') return [
    ['Observed events',String(report.observed)],...(report.estimated !== undefined ? [['Estimated events',String(report.estimated)]] : []),
    ['Coverage',JSON.stringify(report.disclosure)],['UTC filters (from inclusive, to exclusive)',JSON.stringify(report.filters)],
    ...['buckets','paths','crawlers','representations','statuses'].flatMap((group) => /** @type {any} */ (report)[group].map((/** @type {any} */ item) =>
      [group + ': ' + item.key, item.observed + ' observed' + (item.estimated === undefined ? '' : '; ' + item.estimated + ' estimated')])),
  ];
  if (report.type === 'changes') return [['Baseline digest',report.baselineDigest],['Current digest',report.currentDigest],
    ['Inventory',JSON.stringify({baselineComplete:report.baselineComplete,currentComplete:report.currentComplete})],
    ['RAG changed',String(report.ragChanged)],
    ...report.pages.map((item) => ['Page ' + item.pathname,JSON.stringify(item)]),...report.artifacts.map((item) => ['Artifact ' + item.pathname,JSON.stringify(item)])];
  if (report.type === 'inspect') return [['Build digest',report.buildDigest],['Inventory complete',String(report.inventoryComplete)],
    ...report.pages.map((item) => ['Page ' + item.snapshot.pathname,JSON.stringify(item,null,2)]),...report.artifacts.map((item) => ['Artifact ' + item.pathname,JSON.stringify(item)])];
  if (report.type === 'rag') return [['Source',report.source],['Build digest',report.buildDigest ?? '(unavailable)'],
    ['Build-time incomplete',String(report.buildTimeIncomplete)],['Records',String(report.records.length)],
    ...report.records.map((item) => [item.id,JSON.stringify({hash:item.hash,tokenCount:item.tokenCount,tokenizer:item.tokenizer,metadata:item.metadata,oversized:item.oversized})])];
  return [...report.nodes.map((item) => ['Node ' + item.id,JSON.stringify(item)]),...report.edges.map((item) => ['Edge ' + item.from,JSON.stringify(item)])];
}
/** @param {string[]} warnings */
function warningHtml(warnings) { return warnings.length ? '<ul>' + warnings.map((w) => '<li>' + escapeXml(w) + '</li>').join('') + '</ul>' : ''; }
/** @param {string} heading @param {string} body @param {string[]} [scripts] */
function documentHtml(heading,body,scripts = []) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' + cspMeta(REPORT_STYLE,scripts) +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escapeXml(heading) + '</title><style>' + REPORT_STYLE +
    '</style></head><body><h1>' + escapeXml(heading) + '</h1>' + body + '</body></html>\n';
}
/** @param {import('../../src/index.js').GraphReportV1} report */
function graphHtml(report) {
  const data = JSON.stringify({nodes:report.nodes,edges:report.edges}).replace(/[<>&\u2028\u2029]/g,(char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4,'0'));
  const nodes = report.nodes.map((n) => '<tr><td>' + escapeXml(n.id) + '</td><td>' + escapeXml(n.label) + '</td><td>' + escapeXml(n.types.join(', ')) + '</td></tr>').join('\n');
  const edges = report.edges.map((e) => '<tr><td>' + escapeXml(e.from) + '</td><td>' + escapeXml(e.property) + '</td><td>' + escapeXml(e.to) + '</td></tr>').join('\n');
  const controls = '<noscript><p>JavaScript is disabled: all selected nodes and edges are shown below.</p></noscript>' +
    '<label>Search <input id="graph-query" type="search"></label><label>Type <select id="graph-type"><option value="">All</option></select></label>' +
    '<label>Neighborhood <select id="graph-center"><option value="">All</option></select></label>' +
    '<label>Depth <select id="graph-depth"><option>0</option><option selected>1</option><option>2</option><option>3</option></select></label><p id="graph-count"></p>';
  return documentHtml('Astro-AEO graph',warningHtml(report.warnings) + controls +
    '<h2>Nodes</h2><table id="graph-nodes"><thead><tr><th>ID</th><th>Label</th><th>Types</th></tr></thead><tbody>' + nodes + '</tbody></table>' +
    '<h2>Edges</h2><table id="graph-edges"><thead><tr><th>From</th><th>Property</th><th>To</th></tr></thead><tbody>' + edges + '</tbody></table>' +
    '<script id="graph-data" type="application/json">' + data + '</script><script>' + GRAPH_SCRIPT + '</script>',[data,GRAPH_SCRIPT]);
}
