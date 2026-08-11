// @ts-check
import { createGraph, mergeGraph, serializeGraph, validateGraph } from '../schema.js';

export const SCHEMA_MAP_NAMESPACE = 'https://zaai.com/astro-aeo/schema-map/1';

/**
 * Render the experimental semantic corpus pair from already-normalized page
 * graphs. The function is pure so static writers and runtime responders share
 * byte-identical representations.
 *
 * @param {{ page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph }[]} records
 * @param {{ graphUrl: string; strictReferences?: boolean }} options
 */
export function renderSchemaCorpus(records, options) {
  const orderedPages = records.flatMap((record) =>
    typeof record.page.canonicalUrl === 'string'
      ? [{ ...record, canonicalUrl: record.page.canonicalUrl }]
      : [],
  ).sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
  const merged = mergeGraph(orderedPages.map(({ graph }) => graph));
  const entities = merged.entries.map((entry) => entry.entity).sort(compareEntity);
  const graph = createGraph(
    /** @type {import('../schema.js').GraphInput} */ (/** @type {unknown} */ (entities)),
  );
  const knownEntityIds = entities.flatMap((entity) => typeof entity['@id'] === 'string' ? [entity['@id']] : []);
  const siteUrl = new URL('/', options.graphUrl).href;
  const result = validateGraph(graph, {
    knownEntityIds,
    siteUrl,
    strictReferences: options.strictReferences ?? true,
  });
  const diagnostics = result.findings.map((finding) => ({
    version: /** @type {const} */ (1),
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    ...(finding.pathname ? { pathname: finding.pathname } : {}),
  }));

  const mapEntries = [];
  for (const { page, graph: pageGraph } of orderedPages) {
    for (const { entity } of pageGraph.entries.slice().sort((a, b) => compareEntity(a.entity, b.entity))) {
      const id = entity['@id'];
      if (typeof id !== 'string' || !id) {
        diagnostics.push({
          version: /** @type {const} */ (1),
          code: 'schema-map-anonymous-entity',
          severity: /** @type {const} */ ('warning'),
          message: 'An anonymous entity remains in graph.jsonld but cannot appear in schema-map.xml.',
          pathname: page.pathname,
        });
        continue;
      }
      const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']];
      for (const type of types.filter((value) => typeof value === 'string').sort()) {
        mapEntries.push({ page: canonicalUrlFor(page), id, type });
      }
    }
  }
  mapEntries.sort((a, b) => a.page.localeCompare(b.page) || a.id.localeCompare(b.id) || a.type.localeCompare(b.type));

  return {
    graph: {
      body: `${serializeGraph(graph, {
        knownEntityIds,
        siteUrl,
        strictReferences: options.strictReferences ?? true,
      })}\n`,
      contentType: 'application/ld+json; charset=utf-8',
    },
    map: {
      body: renderSchemaMap(options.graphUrl, mapEntries),
      contentType: 'application/xml; charset=utf-8',
    },
    diagnostics,
  };
}

/** @param {import('../index.js').AeoPageRecord} page */
function canonicalUrlFor(page) {
  if (!page.canonicalUrl) throw new TypeError('Schema corpus pages require a canonical URL.');
  return page.canonicalUrl;
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function compareEntity(left, right) {
  const leftId = typeof left['@id'] === 'string' ? left['@id'] : '\uffff';
  const rightId = typeof right['@id'] === 'string' ? right['@id'] : '\uffff';
  const leftType = Array.isArray(left['@type']) ? left['@type'].join(',') : String(left['@type'] ?? '');
  const rightType = Array.isArray(right['@type']) ? right['@type'].join(',') : String(right['@type'] ?? '');
  return leftId.localeCompare(rightId) || leftType.localeCompare(rightType) ||
    JSON.stringify(left).localeCompare(JSON.stringify(right));
}

/** @param {string} graphUrl @param {{page: string; id: string; type: string}[]} entries */
function renderSchemaMap(graphUrl, entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<schema-map xmlns="${SCHEMA_MAP_NAMESPACE}">`,
    ...entries.map((entry) =>
      `  <entry graph="${escapeXml(graphUrl)}" page="${escapeXml(entry.page)}" id="${escapeXml(entry.id)}" type="${escapeXml(entry.type)}"/>`,
    ),
    '</schema-map>',
  ];
  return `${lines.join('\n')}\n`;
}

/** @param {string} value */
function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
