// @ts-check
import { createGraph, serializeGraph, validateGraph } from '../schema.js';
import { MANAGED_GRAPH_ATTRIBUTE } from './head.js';
import {
  htmlElementRanges,
  htmlTagAttribute,
  insertIntoHead,
  removeHtmlElements,
} from './html-head-ranges.js';

/**
 * Reconcile the two graph views exposed to lifecycle plugins and regenerate the
 * one managed JSON-LD script. The authored graph never crosses the public hook
 * boundary, so plugins cannot accidentally rewrite authored scripts.
 *
 * @param {object} input
 * @param {{ html: string; graph: import('../schema.js').AeoGraph | null; normalizedGraph: import('../schema.js').AeoGraph | null; authoredGraph: import('../schema.js').AeoGraph | null; canonicalUrl?: string }} input.baseline
 * @param {{ html: string; page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph | null; normalizedGraph?: import('../schema.js').AeoGraph | null; [key: string]: any }} input.value
 * @param {string | undefined} input.siteUrl
 * @param {boolean} input.strictReferences
 * @param {string} input.pathname
 * @returns {{ valid: true; value: { html: string; page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph | null; normalizedGraph: import('../schema.js').AeoGraph | null; [key: string]: any }; diagnostics: import('../index.js').Diagnostic[]; changes: { graph: boolean; normalizedGraph: boolean; managedPatch: SemanticGraphPatch } } | { valid: false; diagnostics: import('../index.js').Diagnostic[] }}
 */
export function reconcileSemanticEnvelope({ baseline, value, siteUrl, strictReferences, pathname }) {
  if (!sameAuthoredJsonLd(baseline.html, value.html)) {
    return invalidResult(pathname, 'A graph plugin attempted to rewrite authored JSON-LD.');
  }

  const rawGraph = graphOrNull(value.graph);
  const rawNormalized = graphOrNull(value.normalizedGraph);
  const canonicalUrl = value.page.canonicalUrl ?? baseline.canonicalUrl;
  if (typeof canonicalUrl !== 'string') {
    if (rawGraph === null && rawNormalized === null) {
      return {
        valid: true,
        value: {
          ...value,
          html: removeManagedGraph(value.html),
          graph: null,
          normalizedGraph: null,
        },
        diagnostics: [],
        changes: { graph: false, normalizedGraph: false, managedPatch: { operations: [] } },
      };
    }
    return invalidResult(pathname, 'A graph plugin removed the page canonical required to reconcile semantic output.');
  }

  const managedValidation = normalizePluginGraph(rawGraph, {
    canonicalUrl,
    siteUrl,
    strictReferences: false,
  });
  if (!managedValidation.valid) return invalidGraphResult(pathname);
  const normalizedValidation = normalizePluginGraph(rawNormalized, {
    canonicalUrl,
    siteUrl,
    strictReferences,
  });
  if (!normalizedValidation.valid) return invalidGraphResult(pathname);

  const diagnostics = validationDiagnostics(
    [...managedValidation.findings, ...normalizedValidation.findings],
    pathname,
  );
  const suppliedGraph = managedValidation.graph;
  const suppliedNormalized = normalizedValidation.graph;
  const authoredGraph = baseline.authoredGraph ?? createGraph([]);
  const managedChanged = !sameSemanticGraph(suppliedGraph, graphOrNull(baseline.graph));
  const normalizedChanged = !sameSemanticGraph(suppliedNormalized, graphOrNull(baseline.normalizedGraph));
  let managedGraph = suppliedGraph;
  let normalizedGraph = suppliedNormalized;

  if (managedChanged && !normalizedChanged) {
    const combined = combineGraphs(authoredGraph, managedGraph, {
      canonicalUrl,
      siteUrl,
      strictReferences,
    });
    if (!combined.valid) return invalidGraphResult(pathname);
    diagnostics.push(...validationDiagnostics(combined.findings, pathname));
    normalizedGraph = graphOrNull(combined.graph);
  } else if (!managedChanged && normalizedChanged) {
    managedGraph = managedDelta(normalizedGraph, authoredGraph);
    const combined = combineGraphs(authoredGraph, managedGraph, {
      canonicalUrl,
      siteUrl,
      strictReferences,
    });
    if (!combined.valid) return invalidGraphResult(pathname);
    diagnostics.push(...validationDiagnostics(combined.findings, pathname));
    if (!sameSemanticGraph(normalizedGraph, graphOrNull(combined.graph))) {
      return invalidResult(pathname, 'A graph plugin supplied a normalized graph that cannot be represented without rewriting authored JSON-LD.');
    }
    normalizedGraph = graphOrNull(combined.graph);
  } else if (managedChanged && normalizedChanged) {
    const combined = combineGraphs(authoredGraph, managedGraph, {
      canonicalUrl,
      siteUrl,
      strictReferences,
    });
    if (!combined.valid) return invalidGraphResult(pathname);
    diagnostics.push(...validationDiagnostics(combined.findings, pathname));
    if (!sameSemanticGraph(normalizedGraph, graphOrNull(combined.graph))) {
      return invalidResult(pathname, 'A graph plugin supplied inconsistent managed and normalized graphs.');
    }
    normalizedGraph = graphOrNull(combined.graph);
  }

  try {
    const html = renderManagedGraph(value.html, managedGraph, {
      documentCanonical: canonicalUrl,
      siteUrl,
    });
    if (managedGraph && html === removeManagedGraph(value.html)) {
      return invalidResult(pathname, 'A graph plugin produced managed schema for a document without a writable head.');
    }
    return {
      valid: true,
      value: { ...value, html, graph: managedGraph, normalizedGraph },
      diagnostics: uniqueDiagnostics(diagnostics),
      changes: {
        graph: managedChanged,
        normalizedGraph: normalizedChanged,
        // Every accepted normalized view is representable as authored facts
        // plus a managed delta. Capturing the delta from the original managed
        // baseline lets deferred builds replay only plugin intent against a
        // newer authored snapshot.
        managedPatch: createSemanticGraphPatch(graphOrNull(baseline.graph), managedGraph),
      },
    };
  } catch {
    return invalidResult(pathname, 'A graph plugin produced semantic output that could not be serialized.');
  }
}

/**
 * @typedef {{
 *   operations: Array<
 *     | { kind: 'add'; after: import('../schema.js').GraphEntry }
 *     | { kind: 'remove'; before: import('../schema.js').GraphEntry }
 *     | { kind: 'update'; id: string; entity: ValuePatch | null; roles: ValuePatch | null; provenance: ValuePatch | null }
 *   >,
 * }} SemanticGraphPatch
 */

/**
 * @typedef {
 *   | { kind: 'replace'; before: any; after: any }
 *   | { kind: 'object'; properties: Array<{ key: string; before: boolean; after: boolean; patch: ValuePatch | null; value?: any }> }
 *   | { kind: 'array'; removals: any[]; additions: any[]; updates: Array<{ id: string; patch: ValuePatch }> }
 * } ValuePatch
 */

/**
 * Replay an accepted semantic graph change against a newer managed baseline.
 * A false result means a later integration changed the same semantic fact and
 * the deferred transform must fail closed.
 *
 * @param {import('../schema.js').AeoGraph | null} baseline
 * @param {SemanticGraphPatch} patch
 * @returns {{ valid: true; graph: import('../schema.js').AeoGraph | null } | { valid: false }}
 */
export function applySemanticGraphPatch(baseline, patch) {
  let entries = (baseline?.entries ?? []).map(cloneEntry);
  try {
    for (const operation of patch.operations) {
      if (operation.kind === 'add') {
        const id = entryId(operation.after);
        const index = id === undefined ? entries.findIndex((entry) => sameEntry(entry, operation.after)) : findEntry(entries, id);
        if (index < 0) {
          entries.push(cloneEntry(operation.after));
          continue;
        }
        if (sameEntry(entries[index], operation.after)) continue;
        if (id === undefined) throw new SemanticPatchConflictError();
        entries[index] = mergeAddedEntry(entries[index], operation.after);
        continue;
      }

      if (operation.kind === 'remove') {
        const id = entryId(operation.before);
        const index = id === undefined ? entries.findIndex((entry) => sameEntry(entry, operation.before)) : findEntry(entries, id);
        if (index < 0) continue;
        if (!sameEntry(entries[index], operation.before)) throw new SemanticPatchConflictError();
        entries.splice(index, 1);
        continue;
      }

      const index = findEntry(entries, operation.id);
      if (index < 0) throw new SemanticPatchConflictError();
      const current = entries[index];
      entries[index] = {
        entity: operation.entity ? applyValuePatch(current.entity, operation.entity) : current.entity,
        roles: operation.roles ? applyValuePatch(current.roles, operation.roles) : current.roles,
        provenance: operation.provenance
          ? applyValuePatch(current.provenance, operation.provenance)
          : current.provenance,
      };
    }
    return { valid: true, graph: graphOrNull(createGraph(entries)) };
  } catch {
    return { valid: false };
  }
}

/**
 * @param {import('../schema.js').AeoGraph | null} before
 * @param {import('../schema.js').AeoGraph | null} after
 * @returns {SemanticGraphPatch}
 */
function createSemanticGraphPatch(before, after) {
  const original = before?.entries ?? [];
  const desired = after?.entries ?? [];
  const operations = [];
  const matched = new Set();

  for (const beforeEntry of original) {
    const id = entryId(beforeEntry);
    const index = id === undefined
      ? desired.findIndex((entry, candidate) => !matched.has(candidate) && sameEntry(entry, beforeEntry))
      : desired.findIndex((entry) => entryId(entry) === id);
    if (index < 0) {
      operations.push({ kind: /** @type {const} */ ('remove'), before: cloneEntry(beforeEntry) });
      continue;
    }
    matched.add(index);
    const afterEntry = desired[index];
    if (sameEntry(beforeEntry, afterEntry)) continue;
    if (id === undefined) {
      operations.push({ kind: /** @type {const} */ ('remove'), before: cloneEntry(beforeEntry) });
      operations.push({ kind: /** @type {const} */ ('add'), after: cloneEntry(afterEntry) });
      continue;
    }
    operations.push({
      kind: /** @type {const} */ ('update'),
      id,
      entity: diffValue(beforeEntry.entity, afterEntry.entity),
      roles: diffValue(beforeEntry.roles, afterEntry.roles),
      provenance: diffValue(beforeEntry.provenance, afterEntry.provenance),
    });
  }
  for (let index = 0; index < desired.length; index++) {
    if (!matched.has(index)) {
      operations.push({ kind: /** @type {const} */ ('add'), after: cloneEntry(desired[index]) });
    }
  }
  return { operations };
}

/** @param {any} before @param {any} after @returns {ValuePatch | null} */
function diffValue(before, after) {
  if (sameEntity(before, after)) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    const matched = new Set();
    const removals = [];
    const updates = [];
    for (const item of before) {
      let index = after.findIndex((candidate, candidateIndex) =>
        !matched.has(candidateIndex) && sameEntity(candidate, item));
      if (index >= 0) {
        matched.add(index);
        continue;
      }
      const id = valueId(item);
      index = id === undefined ? -1 : after.findIndex((candidate, candidateIndex) =>
        !matched.has(candidateIndex) && valueId(candidate) === id);
      if (index < 0) {
        removals.push(cloneValue(item));
        continue;
      }
      matched.add(index);
      const patch = diffValue(item, after[index]);
      if (patch) updates.push({ id, patch });
    }
    const additions = after.flatMap((item, index) => matched.has(index) ? [] : [cloneValue(item)]);
    const granular = /** @type {ValuePatch} */ ({ kind: 'array', removals, additions, updates });
    try {
      // Arrays in Schema.org are ordered data. Keep the granular patch only
      // when it reproduces the requested order exactly. Reorders and middle
      // insertions become optimistic whole-array replacements so a concurrent
      // semantic change cannot silently produce a different committed graph.
      if (sameEntity(applyValuePatch(cloneValue(before), granular), after)) return granular;
    } catch {
      // Fall through to the fail-closed replacement patch.
    }
    return { kind: 'replace', before: cloneValue(before), after: cloneValue(after) };
  }
  if (isRecord(before) && isRecord(after)) {
    const properties = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const hadBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      if (!hasAfter) {
        properties.push({ key, before: true, after: false, patch: null, value: cloneValue(before[key]) });
        continue;
      }
      if (!hadBefore) {
        properties.push({ key, before: false, after: true, patch: null, value: cloneValue(after[key]) });
        continue;
      }
      const patch = diffValue(before[key], after[key]);
      if (patch) properties.push({ key, before: true, after: true, patch });
    }
    return { kind: 'object', properties };
  }
  return { kind: 'replace', before: cloneValue(before), after: cloneValue(after) };
}

/** @param {any} current @param {ValuePatch} patch @returns {any} */
function applyValuePatch(current, patch) {
  if (patch.kind === 'replace') {
    if (sameEntity(current, patch.after)) return current;
    if (!sameEntity(current, patch.before)) throw new SemanticPatchConflictError();
    return cloneValue(patch.after);
  }
  if (patch.kind === 'array') {
    if (!Array.isArray(current)) throw new SemanticPatchConflictError();
    const output = current.map(cloneValue);
    for (const removal of patch.removals) {
      const index = output.findIndex((item) => sameEntity(item, removal));
      if (index >= 0) {
        output.splice(index, 1);
        continue;
      }
      if (valueId(removal) !== undefined && output.some((item) => valueId(item) === valueId(removal))) {
        throw new SemanticPatchConflictError();
      }
    }
    for (const update of patch.updates) {
      const index = output.findIndex((item) => valueId(item) === update.id);
      if (index < 0) throw new SemanticPatchConflictError();
      output[index] = applyValuePatch(output[index], update.patch);
    }
    for (const addition of patch.additions) addArrayValue(output, addition);
    return output;
  }
  if (!isRecord(current)) throw new SemanticPatchConflictError();
  const output = /** @type {Record<string, any>} */ (cloneValue(current));
  for (const property of patch.properties) {
    const exists = Object.hasOwn(output, property.key);
    if (!property.after) {
      if (!exists) continue;
      if (!sameEntity(output[property.key], property.value)) throw new SemanticPatchConflictError();
      delete output[property.key];
      continue;
    }
    if (!property.before) {
      if (!exists) output[property.key] = cloneValue(property.value);
      else output[property.key] = mergeAddedValue(output[property.key], property.value);
      continue;
    }
    if (!exists || !property.patch) throw new SemanticPatchConflictError();
    output[property.key] = applyValuePatch(output[property.key], property.patch);
  }
  return output;
}

/** @param {any} current @param {any} addition */
function mergeAddedValue(current, addition) {
  if (sameEntity(current, addition)) return current;
  if (Array.isArray(current) && Array.isArray(addition)) {
    const output = current.map(cloneValue);
    for (const item of addition) addArrayValue(output, item);
    return output;
  }
  if (isRecord(current) && isRecord(addition)) {
    const patch = diffValue({}, addition);
    if (!patch) return current;
    return applyValuePatch(current, patch);
  }
  throw new SemanticPatchConflictError();
}

/** @param {any[]} output @param {any} addition */
function addArrayValue(output, addition) {
  if (output.some((item) => sameEntity(item, addition))) return;
  const id = valueId(addition);
  const index = id === undefined ? -1 : output.findIndex((item) => valueId(item) === id);
  if (index < 0) output.push(cloneValue(addition));
  else output[index] = mergeAddedValue(output[index], addition);
}

/**
 * @param {import('../schema.js').GraphEntry} current
 * @param {import('../schema.js').GraphEntry} addition
 */
function mergeAddedEntry(current, addition) {
  return {
    entity: mergeAddedValue(current.entity, addition.entity),
    roles: mergeAddedValue(current.roles, addition.roles),
    provenance: mergeAddedValue(current.provenance, addition.provenance),
  };
}

/** @param {import('../schema.js').GraphEntry[]} entries @param {string} id */
function findEntry(entries, id) {
  return entries.findIndex((entry) => entryId(entry) === id);
}

/** @param {import('../schema.js').GraphEntry} entry */
function entryId(entry) {
  return valueId(entry.entity);
}

/** @param {unknown} value */
function valueId(value) {
  return isRecord(value) && typeof value['@id'] === 'string' ? value['@id'] : undefined;
}

/** @param {import('../schema.js').GraphEntry} entry */
function cloneEntry(entry) {
  return {
    entity: cloneValue(entry.entity),
    roles: [...entry.roles],
    provenance: entry.provenance.map((item) => cloneValue(item)),
  };
}

/** @param {unknown} value @returns {any} */
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  return value;
}

/** @param {import('../schema.js').GraphEntry} left @param {import('../schema.js').GraphEntry} right */
function sameEntry(left, right) {
  return sameEntity(left.entity, right.entity) && sameEntryMetadata(left, right);
}

class SemanticPatchConflictError extends Error {}

/**
 * @param {import('../schema.js').AeoGraph} authoredGraph
 * @param {import('../schema.js').AeoGraph | null} managedGraph
 * @param {{ canonicalUrl: string; siteUrl?: string; strictReferences: boolean }} options
 */
function combineGraphs(authoredGraph, managedGraph, options) {
  return validateGraph([
    ...authoredGraph.entries,
    ...(managedGraph?.entries ?? []),
  ], {
    documentCanonical: options.canonicalUrl,
    siteUrl: options.siteUrl,
    strictReferences: options.strictReferences,
  });
}

/**
 * @param {import('../schema.js').AeoGraph | null} graph
 * @param {{ canonicalUrl: string; siteUrl?: string; strictReferences: boolean }} options
 */
function normalizePluginGraph(graph, options) {
  if (!graph) return { valid: true, graph: null, findings: [] };
  const result = validateGraph(graph, {
    documentCanonical: options.canonicalUrl,
    siteUrl: options.siteUrl,
    strictReferences: options.strictReferences,
  });
  return {
    valid: result.valid,
    graph: graphOrNull(result.graph),
    findings: result.findings,
  };
}

/**
 * @param {import('../schema.js').AeoGraph | null} combinedGraph
 * @param {import('../schema.js').AeoGraph} authoredGraph
 * @returns {import('../schema.js').AeoGraph | null}
 */
function managedDelta(combinedGraph, authoredGraph) {
  if (!combinedGraph) return null;
  const authoredById = new Map(authoredGraph.entries.flatMap((entry) =>
    typeof entry.entity['@id'] === 'string' ? [[entry.entity['@id'], entry]] : [],
  ));
  const anonymous = authoredGraph.entries.filter(({ entity }) =>
    typeof entity['@id'] !== 'string');
  const usedAnonymous = new Set();
  const entries = combinedGraph.entries.flatMap((entry) => {
    const entity = entry.entity;
    const id = typeof entity['@id'] === 'string' ? entity['@id'] : undefined;
    if (!id) {
      const index = anonymous.findIndex((candidate, candidateIndex) =>
        !usedAnonymous.has(candidateIndex) && sameEntity(candidate.entity, entity));
      if (index < 0) return [entry];
      usedAnonymous.add(index);
      if (!sameEntryMetadata(anonymous[index], entry)) return [entry];
      return [];
    }
    const authored = authoredById.get(id);
    if (!authored) return [entry];
    const delta = subtractValue(entity, authored.entity, true);
    const metadataChanged = !sameEntryMetadata(authored, entry);
    if (delta === NO_DELTA && !metadataChanged) return [];
    return [{
      ...entry,
      entity: delta === NO_DELTA ? identityEntity(entity) : delta,
    }];
  });
  const graph = createGraph(/** @type {any} */ (entries));
  return graphOrNull(graph);
}

const NO_DELTA = Symbol('no semantic delta');

/**
 * Derive only additive facts. Removals and conflicting scalar replacements are
 * deliberately left for recombination validation to reject.
 *
 * @param {any} value
 * @param {any} authored
 * @param {boolean} [entityRoot]
 * @returns {any | typeof NO_DELTA}
 */
function subtractValue(value, authored, entityRoot = false) {
  if (sameEntity(value, authored)) return NO_DELTA;
  if (Array.isArray(value) && Array.isArray(authored)) {
    const used = new Set();
    const additions = [];
    for (const item of value) {
      let index = authored.findIndex((candidate, candidateIndex) =>
        !used.has(candidateIndex) && sameEntity(candidate, item));
      if (index >= 0) {
        used.add(index);
        continue;
      }
      const itemId = isRecord(item) && typeof item['@id'] === 'string' ? item['@id'] : undefined;
      index = itemId === undefined ? -1 : authored.findIndex((candidate, candidateIndex) =>
        !used.has(candidateIndex) && isRecord(candidate) && candidate['@id'] === itemId);
      if (index < 0) {
        additions.push(item);
        continue;
      }
      used.add(index);
      const delta = subtractValue(item, authored[index]);
      if (delta !== NO_DELTA) additions.push(delta);
    }
    return additions.length > 0 ? additions : NO_DELTA;
  }
  if (isRecord(value) && isRecord(authored)) {
    /** @type {Record<string, any>} */
    const output = {};
    const typeDelta = subtractTypes(value['@type'], authored['@type']);
    for (const [key, child] of Object.entries(value)) {
      if (key === '@id' || key === '@type') continue;
      if (!Object.hasOwn(authored, key)) {
        output[key] = child;
        continue;
      }
      const delta = subtractValue(child, authored[key]);
      if (delta !== NO_DELTA) output[key] = delta;
    }
    if (Object.keys(output).length === 0 && typeDelta === NO_DELTA) return NO_DELTA;
    if (typeof value['@id'] === 'string') output['@id'] = value['@id'];
    if (typeDelta !== NO_DELTA) {
      output['@type'] = typeDelta;
    } else if (value['@type'] !== undefined) {
      // Preserve an unchanged type as structural context for a factual delta.
      // One type is sufficient because the authored graph continues to own the
      // complete type set and managed graph roots must remain valid entities.
      output['@type'] = firstType(value['@type']);
    }
    return output;
  }
  if (entityRoot) return value;
  return value;
}

/**
 * Return only types introduced by a normalized-only replacement. Recombining
 * them with authored types reproduces an additive change, while removals and
 * replacements still fail the final graph equality check.
 *
 * @param {unknown} value
 * @param {unknown} authored
 * @returns {string | string[] | typeof NO_DELTA}
 */
function subtractTypes(value, authored) {
  const prior = typeValues(authored);
  const additions = typeValues(value).filter((type) => !prior.includes(type));
  if (additions.length === 0) return NO_DELTA;
  return additions.length === 1 ? additions[0] : additions;
}

/** @param {unknown} value @returns {string[]} */
function typeValues(value) {
  return (Array.isArray(value) ? value : [value]).filter(
    (type) => typeof type === 'string',
  );
}

/** @param {unknown} value @returns {string | string[]} */
function firstType(value) {
  const types = typeValues(value);
  return types[0] ?? /** @type {string | string[]} */ (value);
}

/** @param {Record<string, any>} entity */
function identityEntity(entity) {
  return {
    ...(typeof entity['@id'] === 'string' ? { '@id': entity['@id'] } : {}),
    '@type': entity['@type'],
  };
}

/**
 * @param {string} html
 * @param {import('../schema.js').AeoGraph | null} graph
 * @param {{ documentCanonical: string; siteUrl?: string }} options
 */
function renderManagedGraph(html, graph, options) {
  const output = removeManagedGraph(html);
  if (!graph) return output;
  const serialized = serializeGraph(graph, {
    documentCanonical: options.documentCanonical,
    siteUrl: options.siteUrl,
    strictReferences: false,
  });
  return insertIntoHead(
    output,
    `<script type="application/ld+json" ${MANAGED_GRAPH_ATTRIBUTE}>${serialized}</script>`,
  );
}

/** @param {string} html */
export function removeManagedGraph(html) {
  return removeHtmlElements(html, 'script', ({ source }) =>
    htmlTagAttribute(source, MANAGED_GRAPH_ATTRIBUTE) !== undefined,
  );
}

/** @param {import('../schema.js').AeoGraph | null | undefined} graph */
function graphOrNull(graph) {
  return graph?.entries?.length ? graph : null;
}

/** @param {import('../schema.js').AeoGraph | null} left @param {import('../schema.js').AeoGraph | null} right */
export function sameSemanticGraph(left, right) {
  if (left === null || right === null) return left === right;
  /** @param {import('../schema.js').AeoGraph} graph */
  const signature = (graph) => stableJson({
    entries: graph.entries.map((entry) => ({
      entity: entry.entity,
      roles: [...entry.roles].sort(),
      provenance: [...entry.provenance].map((item) => stableJson(item)).sort(),
    })).map((entry) => stableJson(entry)).sort(),
    conflicts: graph.conflicts.map((item) => stableJson(item)).sort(),
  });
  return signature(left) === signature(right);
}

/** @param {import('../schema.js').AeoGraph | null} left @param {import('../schema.js').AeoGraph | null} right */
export function sameSemanticEntities(left, right) {
  if (left === null || right === null) return left === right;
  const signature = (/** @type {import('../schema.js').AeoGraph} */ graph) =>
    stableJson(graph.entries.map((entry) => stableJson(entry.entity)).sort());
  return signature(left) === signature(right);
}

/** @param {unknown} left @param {unknown} right */
function sameEntity(left, right) {
  return stableJson(left) === stableJson(right);
}

/** @param {import('../schema.js').GraphEntry} left @param {import('../schema.js').GraphEntry} right */
function sameEntryMetadata(left, right) {
  return stableJson([...left.roles].sort()) === stableJson([...right.roles].sort()) &&
    stableJson(left.provenance.map((item) => stableJson(item)).sort()) ===
      stableJson(right.provenance.map((item) => stableJson(item)).sort());
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {string} baseline @param {string} candidate */
function sameAuthoredJsonLd(baseline, candidate) {
  return stableJson(authoredJsonLdElements(baseline)) === stableJson(authoredJsonLdElements(candidate));
}

/** @param {string} html */
function authoredJsonLdElements(html) {
  return htmlElementRanges(html, 'script').flatMap((element) => {
    const type = htmlTagAttribute(element.source, 'type')?.trim().toLowerCase();
    const managed = htmlTagAttribute(element.source, MANAGED_GRAPH_ATTRIBUTE) !== undefined;
    return type === 'application/ld+json' && !managed
      ? [html.slice(element.start, element.end)]
      : [];
  });
}

/** @param {unknown} value @returns {string} */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

/** @param {string} pathname */
function invalidGraphResult(pathname) {
  return invalidResult(pathname, 'A graph plugin produced invalid semantic output.');
}

/** @param {readonly import('../schema.js').GraphFinding[]} findings @param {string} pathname */
function validationDiagnostics(findings, pathname) {
  return findings.flatMap((finding) =>
    finding.severity === 'error'
      ? []
      : [{
          version: /** @type {const} */ (1),
          code: 'plugin-graph-validation',
          severity: finding.severity,
          message: 'A graph plugin produced a semantic validation finding.',
          pathname,
        }]);
}

/** @param {import('../index.js').Diagnostic[]} diagnostics */
function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.severity}:${diagnostic.pathname ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {string} pathname @param {string} message */
function invalidResult(pathname, message) {
  return {
    valid: /** @type {const} */ (false),
    diagnostics: [{
      version: /** @type {const} */ (1),
      code: 'plugin-graph-inconsistent',
      severity: /** @type {const} */ ('error'),
      message,
      pathname,
    }],
  };
}
