// @ts-check
import { join } from 'node:path';
import { serializeRagRecords } from '../core/rag.js';
import { canonicalStringify } from './processing-cache.js';
import { evidenceHash } from './evidence.js';

/** Private content exports are separate from sanitized evidence. The index
 * carries the same content-derived build digest, not a clock or timing value.
 * @param {{ projectRoot: string; writer: any; records: import('../index.js').RagRecordV1[];
 * buildDigest: () => string; inventoryComplete: boolean; buildTimeIncomplete: boolean }} input
 */
export function stagePrivateRag(input) {
  const directory = join(input.projectRoot, '.astro', 'aeo-cache', 'rag-v1');
  /** @type {Map<string, {locale: string|null; contentVersion: string|null; records: import('../index.js').RagRecordV1[]}>} */
  const groups = new Map();
  for (const record of input.records) {
    const locale = record.metadata.locale;
    const contentVersion = record.metadata.contentVersion;
    // JSON tuple, then hex-encoded UTF-8, is collision-free and path-safe even
    // for labels spelling dot segments. No source path enters a destination.
    const key = Buffer.from(JSON.stringify([locale, contentVersion])).toString('hex');
    const group = groups.get(key) ?? { locale, contentVersion, records: [] };
    group.records.push(record); groups.set(key, group);
  }
  const files = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, group]) => {
    const file = `${key}.jsonl`;
    const body = serializeRagRecords(group.records);
    input.writer.stagePrivateWrite(join(directory, file), body, { mode: 0o600, confineTo: input.projectRoot });
    return { file, locale: group.locale, contentVersion: group.contentVersion, records: group.records.length, hash: evidenceHash(body) };
  });
  input.writer.stagePrivateWrite(join(directory, 'index-v1.json'), () => `${canonicalStringify({
    version: 1, buildDigest: input.buildDigest(), inventoryComplete: input.inventoryComplete,
    buildTimeIncomplete: input.buildTimeIncomplete || !input.inventoryComplete, files,
  })}\n`, { mode: 0o600, confineTo: input.projectRoot });
}
