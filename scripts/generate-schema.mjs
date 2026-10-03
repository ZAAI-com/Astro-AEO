#!/usr/bin/env node
import { serializeReportSchemas } from './report-schemas.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serializeSchema } from './schema-definition.mjs';
import { serializeRagRecordSchema, serializeRagIndexSchema } from './rag-schema.mjs';
import { serializeAnalyticsEventSchema } from './analytics-schema.mjs';
import { serializeAuditReportSchema } from './audit-report-schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'schema/astro-aeo.schema.json');

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, serializeSchema(), 'utf8');
console.log(`Wrote ${destination}`);

const auditDestination = resolve(root, 'schema/audit-report-v1.schema.json');
await writeFile(auditDestination, serializeAuditReportSchema(), 'utf8');
console.log(`Wrote ${auditDestination}`);

const analyticsDestination = resolve(root, 'schema/analytics-event-v1.schema.json');
await writeFile(analyticsDestination, serializeAnalyticsEventSchema(), 'utf8');
console.log(`Wrote ${analyticsDestination}`);

for (const [file, serialize] of [['rag-record-v1.schema.json',serializeRagRecordSchema],['rag-index-v1.schema.json',serializeRagIndexSchema]]) {
  await writeFile(resolve(root, 'schema', file), serialize(), 'utf8');
  console.log(`Wrote schema/${file}`);
}

for (const [name, body] of Object.entries(serializeReportSchemas())) {
  await writeFile(resolve(root, 'schema', name + '.schema.json'), body, 'utf8');
}
