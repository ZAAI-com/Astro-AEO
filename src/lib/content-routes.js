// @ts-check
// Ecosystem integration declarations stay in the native integration graph,
// never in consumer configuration or a runtime module. Hook closures retain
// their factory's integration identity even if Astro normalizes its wrapper.
/** @type {WeakMap<object, readonly string[]>} */
const declared = new WeakMap();

/** @param {object} integration @param {readonly string[]} patterns */
export function declareContentRoutes(integration, patterns) {
  declared.set(integration, Object.freeze([...patterns]));
}

/** @param {object} integration */
export function contentRoutesFor(integration) {
  return declared.get(integration) ?? [];
}
