// @ts-check

/**
 * A configuration problem that cannot be resolved by defaulting, so the build
 * must stop. Thrown from `resolveConfig` rather than from the `aeo()` factory:
 * inside `astro:config:setup` Astro attributes the failure to this integration,
 * whereas throwing from the factory fails while `astro.config.mjs` is still
 * being evaluated, with a worse message and no logger.
 */
export class AeoConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AeoConfigError';
  }
}
