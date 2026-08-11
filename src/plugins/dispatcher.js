// @ts-check
import { AeoConfigError } from '../lib/errors.js';
import { cloneJsonValue, deepFreeze, immutableJsonValue } from '../core/json-value.js';

export const PLUGIN_STAGES = /** @type {const} */ ([
  'page:discovered',
  'page:extract',
  'page:transform',
  'page:metadata',
  'graph:build',
  'artifact:generate',
  'artifact:validate',
  'build:complete',
]);

const STAGE_SET = new Set(PLUGIN_STAGES);

/**
 * Set up the internal and public plugins once, preserving registration order.
 *
 * @param {object} input
 * @param {import('../index.js').AstroAeoPlugin[]} [input.plugins]
 * @param {import('../index.js').AstroAeoPlugin[]} [input.internalPlugins]
 * @param {'dev'|'build'|'preview'} input.command
 */
export async function createPluginDispatcher({ plugins = [], internalPlugins = [], command }) {
  /** @type {Map<import('../index.js').AstroAeoPluginStage, { plugin: string; hook: import('../index.js').AstroAeoPluginHook<any> }[]>} */
  const hooks = new Map(PLUGIN_STAGES.map((stage) => [stage, []]));
  /** @type {(import('../index.js').PluginArtifactClaim & { plugin: string })[]} */
  const claims = [];
  const runtime = [];
  const names = new Set();
  const userHookStages = new Set();

  for (const entry of [
    ...internalPlugins.map((plugin) => ({ plugin, internal: true })),
    ...plugins.map((plugin) => ({ plugin, internal: false })),
  ]) {
    const { plugin, internal } = entry;
    validateDefinition(plugin, internal, names);
    names.add(plugin.name);
    const claimIds = new Set();
    let active = true;
    const api = Object.freeze({
      command,
      /** @param {import('../index.js').AstroAeoPluginStage} stage @param {import('../index.js').AstroAeoPluginHook<any>} hook */
      on(stage, hook) {
        if (!active) throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" registered a hook after setup completed.`);
        if (!STAGE_SET.has(stage) || typeof hook !== 'function') {
          throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" registered an invalid ${String(stage)} hook.`);
        }
        hooks.get(stage)?.push({ plugin: plugin.name, hook });
        if (!internal) userHookStages.add(stage);
      },
      /** @param {import('../index.js').PluginArtifactClaim} claim */
      claimArtifact(claim) {
        if (!active) throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" claimed an artifact after setup completed.`);
        const normalized = validateClaim(plugin.name, claim);
        if (claimIds.has(normalized.id)) {
          throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" declared duplicate artifact id "${normalized.id}".`);
        }
        claimIds.add(normalized.id);
        claims.push({ ...normalized, plugin: plugin.name });
      },
    });

    try {
      const result = await plugin.setup(api);
      if (result !== undefined) {
        throw new TypeError('setup must not return a value');
      }
    } catch {
      throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" failed during setup.`);
    } finally {
      active = false;
    }

    if (plugin.runtime) {
      runtime.push({
        name: plugin.name,
        apiVersion: 1,
        entrypoint: plugin.runtime.entrypoint instanceof URL
          ? plugin.runtime.entrypoint.href
          : plugin.runtime.entrypoint,
        options: plugin.runtime.options === undefined
          ? null
          : cloneJsonValue(plugin.runtime.options, `plugin ${plugin.name} runtime options`),
        stages: PLUGIN_STAGES.filter((stage) => hooks.get(stage)?.some((item) => item.plugin === plugin.name)),
        claims: claims
          .filter((claim) => claim.plugin === plugin.name)
          .map(({ plugin: _plugin, ...claim }) => claim),
      });
    }
  }

  return {
    claims: deepFreeze(claims.map((claim) => ({ ...claim }))),
    runtimeManifest: deepFreeze({ version: 1, plugins: runtime }),
    /** @param {import('../index.js').AstroAeoPluginStage} stage */
    hasUserHooks(stage) {
      return userHookStages.has(stage);
    },

    /**
     * @template T
     * @param {import('../index.js').AstroAeoPluginStage} stage
     * @param {T} initial
     * @param {{ pathname?: string; mode?: 'build'|'runtime'; validate?: (value: unknown) => boolean }} [context]
     * @returns {Promise<{ value: T; diagnostics: import('../index.js').Diagnostic[]; isolated: boolean }>}
     */
    async run(stage, initial, context = {}) {
      let value = /** @type {T} */ (immutablePipelineInput(initial, `${stage} input`));
      /** @type {import('../index.js').Diagnostic[]} */
      const diagnostics = [];
      for (const registration of hooks.get(stage) ?? []) {
        let result;
        try {
          result = await registration.hook(Object.freeze({
            value,
            ...(context.pathname ? { pathname: context.pathname } : {}),
            mode: context.mode ?? 'build',
          }));
        } catch {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-hook-failed'));
          return { value, diagnostics, isolated: true };
        }

        const normalized = normalizeResult(result, registration.plugin, stage, context.pathname);
        diagnostics.push(...normalized.diagnostics);
        if (normalized.invalid || normalized.action === 'isolate') {
          if (normalized.action === 'isolate' && normalized.diagnostics.length === 0) {
            diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-scope-isolated'));
          }
          return { value, diagnostics, isolated: true };
        }
        if (normalized.action === 'replace') {
          if (context.validate && !context.validate(normalized.value)) {
            diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-replacement'));
            return { value, diagnostics, isolated: true };
          }
          try {
            value = /** @type {T} */ (immutableJsonValue(normalized.value, `${registration.plugin} ${stage} replacement`));
          } catch {
            diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-replacement'));
            return { value, diagnostics, isolated: true };
          }
        }
      }
      return { value, diagnostics, isolated: false };
    },
  };
}

/**
 * Trusted normalized pipeline records can contain own optional properties set
 * to undefined. Crossing the public lifecycle omits those properties exactly as
 * serialization would, then applies the strict clone/freeze rules used for
 * plugin replacements.
 * @param {unknown} value
 * @param {string} label
 */
function immutablePipelineInput(value, label) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be serializable.`);
  }
  if (serialized === undefined) throw new TypeError(`${label} must be serializable.`);
  return immutableJsonValue(JSON.parse(serialized), label);
}

/** @param {import('../index.js').AstroAeoPlugin} plugin @param {boolean} internal @param {Set<string>} names */
function validateDefinition(plugin, internal, names) {
  if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string' || !plugin.name.trim()) {
    throw new AeoConfigError('astro-aeo: every plugin must have a non-empty name.');
  }
  if (!internal && plugin.name.startsWith('astro-aeo:')) {
    throw new AeoConfigError(`astro-aeo: plugin name "${plugin.name}" uses a reserved prefix.`);
  }
  if (names.has(plugin.name)) throw new AeoConfigError(`astro-aeo: duplicate plugin name "${plugin.name}".`);
  if (plugin.apiVersion !== 1 || typeof plugin.setup !== 'function') {
    throw new AeoConfigError(`astro-aeo: plugin "${plugin.name}" must implement API version 1 setup.`);
  }
}

/** @param {string} plugin @param {import('../index.js').PluginArtifactClaim} claim */
function validateClaim(plugin, claim) {
  if (!claim || typeof claim !== 'object' || typeof claim.id !== 'string' || !claim.id.trim()) {
    throw new AeoConfigError(`astro-aeo: plugin "${plugin}" artifact claims require a non-empty id.`);
  }
  if (typeof claim.pathname !== 'string' || !isExactPluginPath(claim.pathname)) {
    throw new AeoConfigError(`astro-aeo: plugin "${plugin}" artifact "${claim.id}" must claim one exact app-relative pathname.`);
  }
  if (claim.replace !== undefined && typeof claim.replace !== 'boolean') {
    throw new AeoConfigError(`astro-aeo: plugin "${plugin}" artifact "${claim.id}" replace must be boolean.`);
  }
  return { id: claim.id, pathname: claim.pathname, ...(claim.replace ? { replace: true } : {}) };
}

/** @param {string} path */
function isExactPluginPath(path) {
  if (!path.startsWith('/') || path === '/' || path.startsWith('//') || path.endsWith('/')) return false;
  if (/[\\?#*{}\[\]]/.test(path) || path.includes('//') || /%(?:2f|5c)/i.test(path)) return false;
  try {
    let decoded = path;
    for (let index = 0; index < 3; index++) decoded = decodeURIComponent(decoded);
    return !decoded.split('/').some((part) => part === '.' || part === '..');
  } catch {
    return false;
  }
}

/**
 * @param {unknown} result
 * @param {string} plugin
 * @param {string} stage
 * @param {string | undefined} pathname
 */
function normalizeResult(result, plugin, stage, pathname) {
  if (result === undefined) return { action: 'keep', diagnostics: [] };
  if (!result || typeof result !== 'object' || !['keep', 'replace', 'isolate'].includes(/** @type {any} */ (result).action)) {
    return { action: 'isolate', diagnostics: [failure(plugin, stage, pathname, 'plugin-invalid-result')], invalid: true };
  }
  const action = /** @type {any} */ (result).action;
  const diagnostics = sanitizeDiagnostics(/** @type {any} */ (result).diagnostics, plugin, stage, pathname);
  if (action === 'replace' && !Object.prototype.hasOwnProperty.call(result, 'value')) {
    return { action, diagnostics: [...diagnostics, failure(plugin, stage, pathname, 'plugin-invalid-result')], invalid: true };
  }
  return { action, value: /** @type {any} */ (result).value, diagnostics };
}

/** @param {unknown} input @param {string} plugin @param {string} stage @param {string | undefined} pathname */
function sanitizeDiagnostics(input, plugin, stage, pathname) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return [failure(plugin, stage, pathname, 'plugin-invalid-diagnostics')];
  return input.map((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== 'object') {
      return failure(plugin, stage, pathname, 'plugin-invalid-diagnostics');
    }
    const severity = ['info', 'warning', 'error'].includes(/** @type {any} */ (diagnostic).severity)
      ? /** @type {'info'|'warning'|'error'} */ (/** @type {any} */ (diagnostic).severity)
      : 'warning';
    return {
      version: /** @type {const} */ (1),
      code: safeToken(/** @type {any} */ (diagnostic).code) || 'plugin-diagnostic',
      severity,
      message: safeMessage(/** @type {any} */ (diagnostic).message),
      ...(pathname ? { pathname } : {}),
      details: { plugin, stage },
    };
  });
}

/** @param {string} plugin @param {string} stage @param {string | undefined} pathname @param {string} code */
function failure(plugin, stage, pathname, code) {
  return {
    version: /** @type {const} */ (1),
    code,
    severity: /** @type {const} */ ('error'),
    message: `Plugin "${plugin}" could not complete ${stage}; its affected output was isolated.`,
    ...(pathname ? { pathname } : {}),
    details: { plugin, stage },
  };
}

/** @param {unknown} value */
function safeToken(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80) : '';
}

/** @param {unknown} value */
function safeMessage(value) {
  if (typeof value !== 'string' || !value.trim()) return 'The plugin reported a diagnostic.';
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
}
