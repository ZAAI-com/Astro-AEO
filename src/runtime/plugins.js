// @ts-check
import { immutableJsonValue } from '../core/json-value.js';
import { textResponse } from './respond.js';

const PLUGIN_STAGES = new Set([
  'page:discovered',
  'page:extract',
  'page:transform',
  'page:metadata',
  'graph:build',
  'artifact:generate',
  'artifact:validate',
  'build:complete',
]);

const GENERIC_FAILURE = 'Internal Server Error\n';

/**
 * @typedef {object} RuntimePluginLoader
 * @property {string} name
 * @property {string} module
 * @property {import('../index.js').JsonValue} [options]
 * @property {string[]} stages
 * @property {{ id: string; pathname: string; replace?: boolean }[]} claims
 * @property {() => Promise<unknown>} load
 */

/**
 * @typedef {object} RuntimePluginPageHandle
 * @property {string} id
 * @property {string} pathname
 * @property {() => Promise<import('../index.js').JsonValue | null>} read
 */

/**
 * @typedef {object} LoadedRuntimePlugins
 * @property {Set<string>} failed
 * @property {(stage: string, initial: unknown, context: { pathname: string; pages?: readonly RuntimePluginPageHandle[]; validate?: (value: unknown) => boolean }) => Promise<{ value: import('../index.js').JsonValue; diagnostics: import('../index.js').Diagnostic[]; isolated: boolean }>} run
 */

/** @type {WeakMap<RuntimePluginLoader[], Map<'dev'|'build'|'preview', Promise<LoadedRuntimePlugins>>>} */
const cache = new WeakMap();

/**
 * Find the one configured plugin claim for an exact app-relative pathname.
 * Generated collisions fail closed. External ownership wins unless the one
 * claimant explicitly opted into replacement during build-time setup.
 *
 * @param {string} pathname
 * @param {RuntimePluginLoader[]} loaders
 * @param {{ projectOwned?: boolean; coreOwned?: boolean }} [options]
 */
export function runtimePluginArtifactFor(pathname, loaders, options = {}) {
  const matches = [];
  for (const loader of loaders) {
    for (const claim of loader.claims) {
      if (claim.pathname === pathname) {
        matches.push({ plugin: loader.name, claim: { ...claim } });
      }
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1 || options.coreOwned) {
    return Object.freeze({ pathname, conflict: true, matches: Object.freeze(matches) });
  }
  const [match] = matches;
  if (options.projectOwned && !match.claim.replace) return null;
  return Object.freeze({ pathname, conflict: false, ...match });
}

/**
 * Create fixed, lazy page handles. A plugin can read only a page Astro-AEO has
 * already enumerated and cannot supply a pathname, request, headers, cookies,
 * credentials, or rewrite target of its own.
 *
 * @template {{ id?: string; pathname: string }} T
 * @param {readonly T[]} pages
 * @param {(page: T) => Promise<unknown>} readPage
 * @returns {readonly RuntimePluginPageHandle[]}
 */
export function createRuntimePluginPageHandles(pages, readPage) {
  const seen = new Set();
  const handles = [];
  for (const page of pages) {
    if (!isExactPathname(page.pathname) || seen.has(page.pathname)) continue;
    seen.add(page.pathname);
    let pending;
    const handle = {
      id: typeof page.id === 'string' && page.id ? page.id : page.pathname,
      pathname: page.pathname,
      read() {
        pending ??= Promise.resolve(readPage(page)).then(sanitizeRuntimePage);
        return pending;
      },
    };
    handles.push(Object.freeze(handle));
  }
  return Object.freeze(handles);
}

/**
 * Serve one plugin-owned representation. Callers decide project ownership and
 * create the fixed page handles. This function owns method handling, runtime
 * module validation, hook isolation, ETags, conditional requests, and generic
 * failures.
 *
 * @param {NonNullable<ReturnType<typeof runtimePluginArtifactFor>>} target
 * @param {Request} request
 * @param {RuntimePluginLoader[]} loaders
 * @param {readonly RuntimePluginPageHandle[]} [pages]
 * @param {'dev'|'build'|'preview'} [command]
 * @returns {Promise<Response | null>}
 */
export async function serveRuntimePluginArtifact(target, request, loaders, pages = [], command = 'build') {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (target.conflict) return failureResponse(request);

  try {
    const runtime = await loadRuntimePlugins(loaders, command);
    if (runtime.failed.has(target.plugin)) return failureResponse(request);

    const claim = immutableJsonValue(target.claim, 'runtime plugin artifact claim');
    const generated = await runtime.run('artifact:generate', {
      claim,
      representation: null,
    }, { pathname: target.pathname, pages });
    if (generated.isolated || !isArtifactEnvelope(generated.value, target.claim, true)) {
      return failureResponse(request);
    }

    const validated = await runtime.run('artifact:validate', generated.value, {
      pathname: target.pathname,
      pages,
    });
    if (validated.isolated || !isArtifactEnvelope(validated.value, target.claim, true)) {
      return failureResponse(request);
    }

    const representation = validated.value.representation;
    if (!isRepresentation(representation)) return failureResponse(request);
    return textResponse({
      body: representation.body,
      contentType: representation.contentType,
      request,
    });
  } catch {
    return failureResponse(request);
  }
}

/**
 * Load and validate runtime modules once per server graph.
 * @param {RuntimePluginLoader[]} loaders
 * @param {'dev'|'build'|'preview'} [command]
 */
export function loadRuntimePlugins(loaders, command = 'build') {
  let commands = cache.get(loaders);
  if (!commands) {
    commands = new Map();
    cache.set(loaders, commands);
  }
  let promise = commands.get(command);
  if (!promise) {
    promise = loadAll(loaders, command);
    commands.set(command, promise);
  }
  return promise;
}

/** @param {RuntimePluginLoader[]} loaders @param {'dev'|'build'|'preview'} command @returns {Promise<LoadedRuntimePlugins>} */
async function loadAll(loaders, command) {
  /** @type {Map<string, { plugin: string; hook: Function }[]>} */
  const hooks = new Map([...PLUGIN_STAGES].map((stage) => [stage, []]));
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {Map<string, string[]>} */
  const failedByStage = new Map([...PLUGIN_STAGES].map((stage) => [stage, []]));

  for (const loader of loaders) {
    const registeredStages = new Set();
    /** @type {{ id: string; pathname: string; replace?: boolean }[]} */
    const registeredClaims = [];
    let active = true;
    try {
      const implementation = await loader.load();
      validateRuntimeModule(implementation, loader);
      const runtimePlugin = /** @type {{ name: string; apiVersion: 1; setup: (api: any) => unknown | Promise<unknown> }} */ (implementation);
      const api = Object.freeze({
        command,
        options: loader.options === undefined
          ? undefined
          : immutableJsonValue(loader.options, `${loader.name} runtime options`),
        /** @param {string} stage @param {Function} hook */
        on(stage, hook) {
          if (!active || !PLUGIN_STAGES.has(stage) || typeof hook !== 'function') {
            throw new TypeError('invalid runtime hook registration');
          }
          if (!loader.stages.includes(stage)) {
            throw new TypeError('runtime hook is absent from the build manifest');
          }
          registeredStages.add(stage);
          hooks.get(stage)?.push({ plugin: loader.name, hook });
        },
        /** @param {{ id: string; pathname: string; replace?: boolean }} claim */
        claimArtifact(claim) {
          if (!active || !isExactClaim(claim)) throw new TypeError('invalid runtime artifact claim');
          if (!loader.claims.some((expected) => sameClaim(expected, claim))) {
            throw new TypeError('runtime artifact claim differs from the build manifest');
          }
          if (registeredClaims.some((current) => sameClaim(current, claim))) {
            throw new TypeError('duplicate runtime artifact claim');
          }
          registeredClaims.push({ ...claim });
        },
      });
      const result = await runtimePlugin.setup(api);
      if (result !== undefined) throw new TypeError('runtime setup must not return a value');
      if (
        registeredStages.size !== loader.stages.length ||
        loader.stages.some((stage) => !registeredStages.has(stage))
      ) {
        throw new TypeError('runtime hook stages differ from the build manifest');
      }
      if (
        registeredClaims.length !== loader.claims.length ||
        loader.claims.some((claim) => !registeredClaims.some((current) => sameClaim(current, claim)))
      ) {
        throw new TypeError('runtime artifact claims differ from the build manifest');
      }
    } catch {
      failed.add(loader.name);
      for (const stage of loader.stages) failedByStage.get(stage)?.push(loader.name);
      for (const registrations of hooks.values()) {
        for (let index = registrations.length - 1; index >= 0; index--) {
          if (registrations[index].plugin === loader.name) registrations.splice(index, 1);
        }
      }
    } finally {
      active = false;
    }
  }

  return {
    failed,
    /**
     * @param {string} stage
     * @param {unknown} initial
     * @param {{ pathname: string; pages?: readonly RuntimePluginPageHandle[]; validate?: (value: unknown) => boolean }} context
     */
    async run(stage, initial, context) {
      let value = immutablePipelineInput(initial, `${stage} runtime input`);
      /** @type {import('../index.js').Diagnostic[]} */
      const diagnostics = [];
      const unavailable = failedByStage.get(stage)?.[0];
      if (unavailable) {
        diagnostics.push(failure(unavailable, stage, context.pathname, 'plugin-runtime-module-failed'));
        return { value, diagnostics, isolated: true };
      }
      for (const registration of hooks.get(stage) ?? []) {
        let result;
        try {
          result = await registration.hook(Object.freeze({
            value,
            pathname: context.pathname,
            mode: 'runtime',
            pages: context.pages ?? Object.freeze([]),
          }));
        } catch {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-hook-failed'));
          return { value, diagnostics, isolated: true };
        }
        if (result === undefined) continue;
        if (!result || typeof result !== 'object') {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-result'));
          return { value, diagnostics, isolated: true };
        }
        const hookResult = /** @type {any} */ (result);
        const sanitized = sanitizeDiagnostics(
          hookResult.diagnostics,
          registration.plugin,
          stage,
          context.pathname,
        );
        if (sanitized === null) {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-diagnostics'));
          return { value, diagnostics, isolated: true };
        }
        diagnostics.push(...sanitized);
        if (hookResult.action === 'keep') continue;
        if (hookResult.action === 'isolate') {
          if (sanitized.length === 0) {
            diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-scope-isolated'));
          }
          return { value, diagnostics, isolated: true };
        }
        if (hookResult.action !== 'replace' || !Object.prototype.hasOwnProperty.call(result, 'value')) {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-result'));
          return { value, diagnostics, isolated: true };
        }
        if (context.validate && !context.validate(hookResult.value)) {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-replacement'));
          return { value, diagnostics, isolated: true };
        }
        try {
          value = immutableJsonValue(hookResult.value, `${registration.plugin} ${stage} runtime replacement`);
        } catch {
          diagnostics.push(failure(registration.plugin, stage, context.pathname, 'plugin-invalid-replacement'));
          return { value, diagnostics, isolated: true };
        }
      }
      return { value, diagnostics, isolated: false };
    },
  };
}

/**
 * Trusted page records can contain optional own properties whose value is
 * undefined. Match the build dispatcher by crossing the public lifecycle
 * through JSON serialization before applying strict clone and freeze rules.
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

/**
 * @param {unknown} input
 * @param {string} plugin
 * @param {string} stage
 * @param {string} pathname
 * @returns {import('../index.js').Diagnostic[] | null}
 */
function sanitizeDiagnostics(input, plugin, stage, pathname) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const diagnostics = [];
  for (const diagnostic of input) {
    if (!diagnostic || typeof diagnostic !== 'object') return null;
    const item = /** @type {any} */ (diagnostic);
    if (typeof item.code !== 'string' || !item.code.trim() ||
      typeof item.message !== 'string' || !item.message.trim() ||
      (item.severity !== undefined && !['info', 'warning', 'error'].includes(item.severity))) {
      return null;
    }
    diagnostics.push({
      version: /** @type {const} */ (1),
      code: safeToken(item.code) || 'plugin-diagnostic',
      severity: item.severity ?? 'warning',
      message: safeMessage(item.message),
      pathname,
      details: { plugin, stage },
    });
  }
  return diagnostics;
}

/** @param {string} plugin @param {string} stage @param {string} pathname @param {string} code */
function failure(plugin, stage, pathname, code) {
  return {
    version: /** @type {const} */ (1),
    code,
    severity: /** @type {const} */ ('error'),
    message: `Plugin "${plugin}" could not complete ${stage}; its affected output was isolated.`,
    pathname,
    details: { plugin, stage },
  };
}

/** @param {unknown} value */
function safeToken(value) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80)
    : '';
}

/** @param {unknown} value */
function safeMessage(value) {
  if (typeof value !== 'string' || !value.trim()) return 'The plugin reported a diagnostic.';
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
}

/** @param {unknown} implementation @param {RuntimePluginLoader} loader */
function validateRuntimeModule(implementation, loader) {
  const plugin = /** @type {any} */ (implementation);
  if (
    !implementation ||
    typeof implementation !== 'object' ||
    plugin.name !== loader.name ||
    plugin.apiVersion !== 1 ||
    typeof plugin.setup !== 'function'
  ) {
    throw new TypeError('invalid runtime plugin module');
  }
}

/** @param {unknown} value @param {{ id: string; pathname: string }} expected @param {boolean} requireRepresentation @returns {value is { claim: { id: string; pathname: string }; representation: { body: string; contentType: string } }} */
function isArtifactEnvelope(value, expected, requireRepresentation) {
  if (!value || typeof value !== 'object') return false;
  const envelope = /** @type {any} */ (value);
  const claim = envelope.claim;
  if (!claim || claim.id !== expected.id || claim.pathname !== expected.pathname) return false;
  return requireRepresentation ? isRepresentation(envelope.representation) : true;
}

/** @param {unknown} value @returns {value is { body: string; contentType: string }} */
function isRepresentation(value) {
  const representation = /** @type {any} */ (value);
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof representation.body === 'string' &&
    typeof representation.contentType === 'string' &&
    representation.contentType.length > 0 &&
    representation.contentType.length <= 200 &&
    representation.contentType.includes('/') &&
    !/[\r\n\u0000-\u001f\u007f]/.test(representation.contentType),
  );
}

/** @param {unknown} value */
function sanitizeRuntimePage(value) {
  if (!value || typeof value !== 'object') return null;
  const page = /** @type {any} */ (value);
  if (typeof page.id !== 'string' || typeof page.pathname !== 'string') return null;
  const safe = {
    id: page.id,
    pathname: page.pathname,
    ...(typeof page.routePattern === 'string' ? { routePattern: page.routePattern } : {}),
    ...(page.rendering === 'prerendered' || page.rendering === 'on-demand'
      ? { rendering: page.rendering }
      : {}),
    ...(typeof page.canonicalUrl === 'string' ? { canonicalUrl: page.canonicalUrl } : {}),
    ...(typeof page.markdownUrl === 'string' ? { markdownUrl: page.markdownUrl } : {}),
    ...(typeof page.language === 'string' ? { language: page.language } : {}),
    ...(page.metadata && typeof page.metadata === 'object' ? { metadata: page.metadata } : {}),
    representations: {
      ...(typeof page.representations?.markdown === 'string'
        ? { markdown: page.representations.markdown }
        : {}),
      ...(typeof page.representations?.plainText === 'string'
        ? { plainText: page.representations.plainText }
        : {}),
    },
    ...(page.dates && typeof page.dates === 'object' ? { dates: page.dates } : {}),
    ...(Array.isArray(page.authors) ? { authors: page.authors } : {}),
    ...(Array.isArray(page.entities) ? { entities: page.entities } : {}),
    ...(page.directives && typeof page.directives === 'object' ? { directives: page.directives } : {}),
    ...(page.extraction && typeof page.extraction === 'object' ? { extraction: page.extraction } : {}),
  };
  try {
    return immutableJsonValue(safe, 'runtime plugin page');
  } catch {
    return null;
  }
}

/** @param {unknown} claim */
function isExactClaim(claim) {
  const candidate = /** @type {any} */ (claim);
  return Boolean(
    claim &&
    typeof claim === 'object' &&
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    isExactPathname(candidate.pathname) &&
    (candidate.replace === undefined || typeof candidate.replace === 'boolean'),
  );
}

/** @param {string} pathname */
function isExactPathname(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname === '/') return false;
  if ([...pathname].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  })) return false;
  if (pathname.startsWith('//') || pathname.endsWith('/') || /[\\?#*{}\[\]]/.test(pathname)) return false;
  if (pathname.includes('//') || /%(?:2f|5c)/i.test(pathname)) return false;
  try {
    let decoded = pathname;
    for (let index = 0; index < 3; index++) decoded = decodeURIComponent(decoded);
    if ([...decoded].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) return false;
    return !decoded.split('/').some((part) => part === '.' || part === '..');
  } catch {
    return false;
  }
}

/** @param {{ id: string; pathname: string; replace?: boolean }} left @param {{ id: string; pathname: string; replace?: boolean }} right */
function sameClaim(left, right) {
  return left.id === right.id && left.pathname === right.pathname && Boolean(left.replace) === Boolean(right.replace);
}

/** @param {Request} request */
function failureResponse(request) {
  return textResponse({
    body: GENERIC_FAILURE,
    contentType: 'text/plain; charset=utf-8',
    request,
    status: 500,
    headers: { 'cache-control': 'no-store' },
  });
}
