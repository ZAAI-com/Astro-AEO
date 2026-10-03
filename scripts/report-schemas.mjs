import { buildRagRecordSchema } from './rag-schema.mjs';
const str = { type: 'string' };
const bool = { type: 'boolean' };
const count = { type: 'integer', minimum: 0 };
const hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const path = { type: 'string', maxLength: 2048, pattern: '^/[^?#\\u0000-\\u001f\\u007f]*$' };
const label = { type: ['string','null'], pattern: '^(?!https?:|[a-zA-Z]:/)[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$' };
const array = (items) => ({ type: 'array', maxItems: 100000, items });
const obj = (properties, optional = []) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties).filter((key) => !optional.includes(key)), properties });
const counts = { type: 'object', propertyNames: { pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$' }, additionalProperties: count };
const components = obj({ source: { ...hash, type: ['string','null'] }, html: hash, markdown: hash, metadata: hash, graph: hash, directives: hash });
const page = obj({ pathname: path, routePattern: path, locale: label, version: label, components }, ['routePattern']);
const artifact = obj({ pathname: path, status: label, owner: label,
  etag: { type: ['string','null'], pattern: '^"[a-f0-9]{64}"$' }, byteLength: { type: ['integer','null'], minimum: 0 } });
const tracePage = obj({ pathname: path, source: label, renderer: label, graphEntities: count,
  graphProvenance: counts, htmlTransforms: array(label), diagnostics: counts });
const warnings = array(str);
const bucket = obj({ key: str, observed: count, estimated: { type: 'number', minimum: 0 } }, ['estimated']);
const change = obj({ pathname: path, locale: label, contentVersion: label,
  status: { enum: ['added','changed','removed','unconfirmed-addition','unconfirmed-removal'] },
  components: array({ enum: ['source','html','markdown','metadata','graph','directives','status','owner','etag','byteLength'] }) });
const node = obj({ id: str, label: str, types: array(str) });
const edge = obj({ from: str, to: str, property: str });
export function buildReportSchemas() {
  const ragRecord = buildRagRecordSchema();
  delete ragRecord.$id; delete ragRecord.$schema; delete ragRecord.title;
  return {
    'page-snapshot-v1': obj({ version: { const: 1 }, buildDigest: hash, inventoryComplete: bool,
      ragHash: hash, pages: array(page), artifacts: array(artifact) }, ['ragHash']),
    'processing-trace-v1': obj({ version: { const: 1 }, buildDigest: hash, inventoryComplete: bool,
      stages: array(obj({ pathname: path, stage: label, outcome: { enum: ['hit','miss','bypass','excluded','redirect','noindex','skip-token','unreadable','isolated','dropped','kept','replaced'] } })),
      pages: array(tracePage), artifacts: array(obj({ pathname: path, action: label })), diagnostics: counts, cacheReasons: counts }),
    'analytics-report-v1': obj({ version: { const: 1 }, type: { const: 'traffic' }, warnings,
      observed: count, estimated: { type: 'number', minimum: 0 },
      filters: obj({ from: { type: ['string','null'] }, to: { type: ['string','null'] } }),
      disclosure: obj({ coverage: { const: 'observable-only' }, classification: { const: 'claimed' },
        sampleRates: array({ type: 'number', exclusiveMinimum: 0, maximum: 1 }), scopes: array({ enum: ['agents','all'] }),
        surfaces: array(str), registryVersions: array(str), weighted: bool, estimateBasis: { const: 'inverse-probability-not-verified-traffic' } }),
      buckets: array(bucket), paths: array(bucket), crawlers: array(bucket), representations: array(bucket), statuses: array(bucket) }, ['estimated']),
    'changes-report-v1': obj({ version: { const: 1 }, type: { const: 'changes' }, warnings,
      baselineDigest: hash, currentDigest: hash, baselineComplete: bool, currentComplete: bool,
      pages: array(change), artifacts: array(change), ragChanged: bool }),
    'inspect-report-v1': obj({ version: { const: 1 }, type: { const: 'inspect' }, warnings,
      buildDigest: hash, inventoryComplete: bool, pages: array(obj({ snapshot: page,
        trace: { anyOf: [tracePage, { type: 'null' }] },
        stages: array(obj({ pathname: path, stage: label, outcome: str })),
        companions: array(obj({ pathname: path, hash: { ...hash, type: ['string','null'] }, tokenCount: { type: ['integer','null'], minimum: 0 } })) })),
      artifacts: array(artifact) }),
    'graph-report-v1': obj({ version: { const: 1 }, type: { const: 'graph' }, warnings, nodes: array(node), edges: array(edge) }),
    'rag-report-v1': obj({ version: { const: 1 }, type: { const: 'rag' }, warnings,
      source: { enum: ['private','companions'] }, buildDigest: { ...hash, type: ['string','null'] },
      inventoryComplete: bool, buildTimeIncomplete: bool, records: array(ragRecord) }),
  };
}
export function serializeReportSchemas() {
  return Object.fromEntries(Object.entries(buildReportSchemas()).map(([name, schema]) => [name,
    JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://zaai.com/astro-aeo/schema/' + name + '.schema.json', title: 'Astro-AEO ' + name, ...schema }, null, 2) + '\n']));
}
