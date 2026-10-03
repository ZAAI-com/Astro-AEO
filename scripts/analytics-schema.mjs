import { ANALYTICS_CRAWLER_REGISTRY } from '../src/core/crawler-registry.js';
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
/** The privacy-fixed wire contract, not an arbitrary request logging envelope. */
export function buildAnalyticsEventSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://raw.githubusercontent.com/ZAAI-com/Astro-AEO/main/schema/analytics-event-v1.schema.json',
    title: 'Astro-AEO request observation, version 1',
    ...object({ version: { const: 1 }, type: { const: 'request' },
      timestamp: { type: 'string', format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:00\\.000Z$' },
      registryVersion: { type: 'string', minLength: 1, maxLength: 16, pattern: '^\\d+$' },
      method: { enum: ['GET', 'HEAD'] }, status: { type: 'integer', minimum: 0, maximum: 599 },
      path: { type: 'string', minLength: 1, maxLength: 2048, pattern: '^(?:/[^?#\\u0000-\\u001f\\u007f]*|\\(unlisted\\))$' },
      pathKind: { enum: ['inventory', 'artifact', 'pattern', 'unlisted'] },
      crawler: object({ identity: { enum: ['unknown', ...ANALYTICS_CRAWLER_REGISTRY.map(({ token }) => token)] }, classification: { enum: ['claimed', 'unclassified'] } }),
      representation: { enum: ['html', 'markdown', 'artifact', 'redirect', 'other'] }, cache: { enum: ['not-modified', 'unknown'] },
      surface: { enum: ['development', 'preview', 'node', 'deno', 'astro', 'cloudflare', 'netlify', 'vercel'] },
      sampleRate: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, scope: { enum: ['agents', 'all'] }, coverage: { const: 'observable-only' },
    }),
  };
}
export function serializeAnalyticsEventSchema() { return `${JSON.stringify(buildAnalyticsEventSchema(), null, 2)}\n`; }
