// @ts-check
import { assertSnapshot } from './contracts.js';
/** @param {import('../../src/index.js').AeoPageSnapshotV1} baseline
 * @param {import('../../src/index.js').AeoPageSnapshotV1} current
 * @returns {import('../../src/index.js').ChangesReportV1} */
export function changesReport(baseline, current) {
  const baselineTrusted = assertSnapshot(baseline), currentTrusted = assertSnapshot(current);
  const baselineComplete = baseline.inventoryComplete && baselineTrusted;
  const currentComplete = current.inventoryComplete && currentTrusted;
  /** @param {readonly any[]} oldItems @param {readonly any[]} newItems @param {boolean} pages */
  const compare = (oldItems,newItems,pages) => {
    const key = (/** @type {any} */ value) => pages ? JSON.stringify([value.pathname,value.locale,value.version]) : value.pathname;
    const old = new Map(oldItems.map((item) => [key(item),item]));
    const now = new Map(newItems.map((item) => [key(item),item]));
    /** @type {import('../../src/index.js').AeoChangeV1[]} */
    const changes = [];
    for (const id of [...new Set([...old.keys(),...now.keys()])].sort()) {
      const before = old.get(id), after = now.get(id), item = after ?? before;
      const fields = pages ? ['source','html','markdown','metadata','graph','directives'] : ['status','owner','etag','byteLength'];
      const components = before && after ? fields.filter((name) => pages ? before.components[name] !== after.components[name] : before[name] !== after[name]) : [];
      if (before && after && !components.length) continue;
      changes.push({pathname:item.pathname,locale:pages ? item.locale : null,contentVersion:pages ? item.version : null,
        status: !before ? baselineComplete ? 'added' : 'unconfirmed-addition' : !after ? currentComplete ? 'removed' : 'unconfirmed-removal' : 'changed',
        components: /** @type {import('../../src/index.js').AeoChangeV1['components']} */ (components) });
    }
    return changes;
  };
  return {version:1,type:'changes',baselineDigest:baseline.buildDigest,currentDigest:current.buildDigest,
    baselineComplete,currentComplete,
    warnings: [
      ...(!baselineTrusted ? ['Baseline snapshot digest mismatch.'] : []),
      ...(!currentTrusted ? ['Current snapshot digest mismatch.'] : []),
      ...(!baselineComplete ? ['Incomplete baseline cannot confirm additions.'] : []),
      ...(!currentComplete ? ['Incomplete current inventory cannot confirm removals.'] : []),
    ],
    pages:compare(baseline.pages,current.pages,true), artifacts:compare(baseline.artifacts,current.artifacts,false),
    ragChanged:baseline.ragHash !== current.ragHash};
}

/** Only confirmed changes trip an explicit gate. @param {import('../../src/index.js').ChangesReportV1} report @param {string} failOn */
export function changesFail(report, failOn) {
  return [...report.pages,...report.artifacts].some((change) => ['added','changed','removed'].includes(change.status) &&
    (failOn === 'any' || change.status === failOn)) || report.ragChanged && ['any','changed'].includes(failOn);
}
