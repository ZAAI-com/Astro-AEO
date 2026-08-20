// @ts-check

/**
 * @typedef {object} RuntimeDynamicRouteLoader
 * @property {string} entrypoint
 * @property {string} pattern
 * @property {string[]} params
 * @property {Array<Array<{ content: string; dynamic: boolean; spread: boolean }>>} segments
 * @property {() => Promise<Record<string, unknown>>} load
 */

/**
 * @typedef {object} RuntimeDynamicRouteSource
 * @property {'startup'|'hot'} mode
 * @property {() => Promise<{ list(): RuntimeDynamicRouteLoader[] | Promise<RuntimeDynamicRouteLoader[]> }>} load
 */

class DynamicRouteValidationError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export class RuntimeDynamicRouteDiscoveryError extends Error {
  /** @param {string} route @param {string} reason */
  constructor(route, reason) {
    const label = safeRouteLabel(route);
    super(
      `astro-aeo: dynamic route discovery failed${label ? ` for ${JSON.stringify(label)}` : ''}: ${reason}.`,
    );
    this.name = 'RuntimeDynamicRouteDiscoveryError';
    this.route = label;
  }
}

/**
 * @param {Pick<import('./serve.js').Runtime, 'command'|'site'>} runtime
 * @param {RuntimeDynamicRouteSource | null | undefined} source
 * @returns {Promise<string[]>}
 */
export async function discoverRuntimeDynamicPaths(runtime, source) {
  if (runtime.command !== 'dev' || !source) return [];

  let mode = 'startup';
  let loadInventory;
  try {
    mode = source.mode;
    loadInventory = source.load;
  } catch {
    throw inventoryError('startup');
  }
  if ((mode !== 'startup' && mode !== 'hot') || typeof loadInventory !== 'function') {
    throw inventoryError(mode === 'hot' ? 'hot' : 'startup');
  }

  let inventory;
  let list;
  try {
    inventory = await Reflect.apply(loadInventory, source, []);
    list = inventory?.list;
  } catch {
    throw inventoryError(mode);
  }
  if (typeof list !== 'function') throw inventoryError(mode);

  let listed;
  try {
    listed = await Reflect.apply(list, inventory, []);
  } catch {
    throw inventoryError(mode);
  }
  let loaders;
  try {
    if (!Array.isArray(listed)) throw new TypeError('invalid route inventory');
    loaders = Array.from(listed);
  } catch {
    throw inventoryError(mode);
  }

  const paths = [];
  const seen = new Set();
  for (const value of loaders) {
    let loader;
    try {
      loader = snapshotLoader(value);
    } catch {
      throw new RuntimeDynamicRouteDiscoveryError('', 'the route inventory returned invalid mechanics');
    }
    const route = loader.pattern || loader.entrypoint;
    let namespace;
    try {
      namespace = await Reflect.apply(loader.load, loader.owner, []);
    } catch {
      throw new RuntimeDynamicRouteDiscoveryError(route, 'the page module could not be loaded');
    }

    let getStaticPaths;
    try {
      getStaticPaths = namespace?.getStaticPaths;
    } catch {
      throw new RuntimeDynamicRouteDiscoveryError(route, 'the page module exports could not be inspected');
    }
    if (typeof getStaticPaths !== 'function') {
      throw new RuntimeDynamicRouteDiscoveryError(route, 'the page module has no getStaticPaths() export');
    }

    let result;
    try {
      result = await Reflect.apply(getStaticPaths, namespace, [{
        routePattern: loader.pattern,
        paginate: createPaginate(loader, runtime.site),
      }]);
    } catch {
      throw new RuntimeDynamicRouteDiscoveryError(route, 'getStaticPaths() could not be evaluated');
    }
    let entries;
    try {
      if (!Array.isArray(result)) throw new TypeError('invalid getStaticPaths result');
      entries = Array.from(result);
    } catch {
      throw new RuntimeDynamicRouteDiscoveryError(route, 'getStaticPaths() did not return an array');
    }

    for (const entry of entries) {
      try {
        const params = validateStaticPathEntry(entry, loader);
        const pathname = generateRoute(params, loader.segments, runtime.site.trailingSlash);
        assertSafeGeneratedPath(pathname);
        if (!seen.has(pathname)) {
          seen.add(pathname);
          paths.push(pathname);
        }
      } catch (error) {
        const reason = error instanceof DynamicRouteValidationError
          ? error.reason
          : 'getStaticPaths() returned an invalid entry';
        throw new RuntimeDynamicRouteDiscoveryError(route, reason);
      }
    }
  }
  return paths;
}

/**
 * @param {unknown} value
 * @returns {RuntimeDynamicRouteLoader & { owner: object }}
 */
function snapshotLoader(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DynamicRouteValidationError('invalid loader');
  }
  const entrypoint = Reflect.get(value, 'entrypoint');
  const pattern = Reflect.get(value, 'pattern');
  const params = Reflect.get(value, 'params');
  const segments = Reflect.get(value, 'segments');
  const load = Reflect.get(value, 'load');
  if (
    typeof entrypoint !== 'string' || entrypoint.length === 0 ||
    typeof pattern !== 'string' || pattern.length === 0 ||
    !Array.isArray(params) || params.some((param) => typeof param !== 'string') ||
    !Array.isArray(segments) || typeof load !== 'function'
  ) {
    throw new DynamicRouteValidationError('invalid loader');
  }
  let dynamic = false;
  const clonedSegments = segments.map((segment) => {
    if (!Array.isArray(segment)) throw new DynamicRouteValidationError('invalid segments');
    return segment.map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        throw new DynamicRouteValidationError('invalid segment');
      }
      const content = Reflect.get(part, 'content');
      const partDynamic = Reflect.get(part, 'dynamic');
      const spread = Reflect.get(part, 'spread');
      if (
        typeof content !== 'string' ||
        typeof partDynamic !== 'boolean' ||
        typeof spread !== 'boolean' ||
        (spread && !partDynamic)
      ) {
        throw new DynamicRouteValidationError('invalid segment');
      }
      if (partDynamic) dynamic = true;
      return { content, dynamic: partDynamic, spread };
    });
  });
  if (!dynamic) throw new DynamicRouteValidationError('route is not dynamic');
  return {
    entrypoint,
    pattern,
    params: [...params],
    segments: clonedSegments,
    load,
    owner: value,
  };
}

/**
 * @param {unknown} entry
 * @param {RuntimeDynamicRouteLoader} loader
 * @returns {Record<string, string | undefined>}
 */
function validateStaticPathEntry(entry, loader) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new DynamicRouteValidationError('getStaticPaths() returned a non-object entry');
  }
  let params;
  try {
    params = Reflect.get(entry, 'params');
  } catch {
    throw new DynamicRouteValidationError('getStaticPaths() returned invalid params');
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new DynamicRouteValidationError('getStaticPaths() returned invalid params');
  }

  /** @type {Record<string, string | undefined>} */
  const copied = Object.create(null);
  let entries;
  try {
    entries = Object.entries(params);
  } catch {
    throw new DynamicRouteValidationError('getStaticPaths() returned invalid params');
  }
  if (entries.length === 0) {
    throw new DynamicRouteValidationError('getStaticPaths() returned empty params');
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'string' && value !== undefined) {
      throw new DynamicRouteValidationError('getStaticPaths() returned a non-string parameter');
    }
    copied[key] = value;
  }
  for (const segment of loader.segments) {
    for (const part of segment) {
      if (part.dynamic && !part.spread && copied[part.content] === undefined) {
        throw new DynamicRouteValidationError('getStaticPaths() omitted a required parameter');
      }
    }
  }
  return copied;
}

/**
 * @param {RuntimeDynamicRouteLoader} loader
 * @param {{ base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 */
function createPaginate(loader, site) {
  /**
   * @param {unknown[]} data
   * @param {{ pageSize?: number; params?: Record<string, string | undefined>; props?: Record<string, unknown>; format?: (url: string) => string }} [args]
   */
  return function paginate(data, args = {}) {
    if (!Array.isArray(data)) throw new DynamicRouteValidationError('paginate() requires an array');
    const {
      pageSize: configuredPageSize,
      params: configuredParams,
      props: configuredProps,
      format: configuredFormat,
    } = args;
    const pageSize = configuredPageSize || 10;
    const additionalParams = configuredParams || {};
    const additionalProps = configuredProps || {};
    const formatUrl = configuredFormat || ((url) => url);
    const includesFirstPageNumber = loader.params.includes('...page')
      ? false
      : loader.params.includes('page')
        ? true
        : null;
    if (includesFirstPageNumber === null) {
      throw new DynamicRouteValidationError('paginate() requires a page parameter');
    }
    const lastPage = Math.max(1, Math.ceil(data.length / pageSize));
    return [...Array(lastPage).keys()].map((index) => {
      const pageNum = index + 1;
      const start = pageSize === Number.POSITIVE_INFINITY ? 0 : (pageNum - 1) * pageSize;
      const end = Math.min(start + pageSize, data.length);
      const params = {
        ...additionalParams,
        page: includesFirstPageNumber || pageNum > 1 ? String(pageNum) : undefined,
      };
      /** @param {Record<string, string | undefined>} nextParams */
      const routeUrl = (nextParams) => addRouteBase(
        generateRoute(nextParams, loader.segments, site.trailingSlash),
        site.base,
      );
      const current = formatUrl(routeUrl(params));
      const next = pageNum === lastPage
        ? undefined
        : formatUrl(routeUrl({ ...params, page: String(pageNum + 1) }));
      const prev = pageNum === 1
        ? undefined
        : formatUrl(routeUrl({
          ...params,
          page: !includesFirstPageNumber && pageNum - 1 === 1
            ? undefined
            : String(pageNum - 1),
        }));
      const first = pageNum === 1
        ? undefined
        : formatUrl(routeUrl({
          ...params,
          page: includesFirstPageNumber ? '1' : undefined,
        }));
      const last = pageNum === lastPage
        ? undefined
        : formatUrl(routeUrl({ ...params, page: String(lastPage) }));
      return {
        params,
        props: {
          ...additionalProps,
          page: {
            data: data.slice(start, end),
            start,
            end: end - 1,
            size: pageSize,
            total: data.length,
            currentPage: pageNum,
            lastPage,
            url: { current, next, prev, first, last },
          },
        },
      };
    });
  };
}

/**
 * @param {Record<string, string | undefined>} params
 * @param {RuntimeDynamicRouteLoader['segments']} segments
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
function generateRoute(params, segments, trailingSlash) {
  /** @type {Record<string, string | undefined>} */
  const validated = Object.create(null);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' && value !== undefined) {
      throw new DynamicRouteValidationError('a route parameter was not a string');
    }
    if (value !== undefined) {
      if (!isWellFormedUnicode(value)) {
        throw new DynamicRouteValidationError('a route parameter contained malformed Unicode');
      }
      validated[key] = trimSlashes(value);
    }
  }
  /** @type {Record<string, string | undefined>} */
  const sanitized = Object.create(null);
  for (const [key, value] of Object.entries(validated)) {
    sanitized[key] = value?.normalize().replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  const pathname = segments.map((segment) => {
    const value = segment.map((part) => {
      if (part.spread) return sanitized[part.content.slice(3)] ?? '';
      if (part.dynamic) {
        const parameter = sanitized[part.content];
        if (parameter === undefined) {
          throw new DynamicRouteValidationError('a required route parameter was missing');
        }
        return parameter;
      }
      if (!isWellFormedUnicode(part.content)) {
        throw new DynamicRouteValidationError('a route segment contained malformed Unicode');
      }
      return part.content
        .normalize()
        .replace(/\?/g, '%3F')
        .replace(/#/g, '%23')
        .replace(/%5B/g, '[')
        .replace(/%5D/g, ']');
    }).join('');
    return value ? `/${value}`.replace(/^\/{2,}/, '/') : '';
  }).join('');
  const trailing = trailingSlash === 'always' && segments.length > 0 ? '/' : '';
  return `${pathname}${trailing}` || '/';
}

/** @param {string} value */
function trimSlashes(value) {
  return value.replace(/^\/|\/$/g, '');
}

/** @param {string} value */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xDC00 || next > 0xDFFF) return false;
      index++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

/** @param {string} route @param {string} base */
function addRouteBase(route, base) {
  const joined = `${removeTrailingSlash(base)}/${removeLeadingSlash(route)}`;
  return joined || '/';
}

/** @param {string} value */
function removeTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** @param {string} value */
function removeLeadingSlash(value) {
  return value.startsWith('/') ? value.slice(1) : value;
}

/** @param {string} pathname */
function assertSafeGeneratedPath(pathname) {
  if (
    typeof pathname !== 'string' ||
    !isWellFormedUnicode(pathname) ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    /[?#\\\u0000-\u001F\u007F]/.test(pathname) ||
    /%(?![0-9A-Fa-f]{2})/.test(pathname)
  ) {
    throw new DynamicRouteValidationError('getStaticPaths() generated an unsafe pathname');
  }
  let current = pathname;
  let segmentCount = current.split('/').length;
  for (let depth = 0; depth < 3; depth++) {
    if (
      current.startsWith('//') ||
      /[\\\u0000-\u001F\u007F]/.test(current) ||
      current.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new DynamicRouteValidationError('getStaticPaths() generated an unsafe pathname');
    }
    if (depth === 2) {
      if (/%[0-9A-Fa-f]{2}/.test(current)) {
        throw new DynamicRouteValidationError('getStaticPaths() generated an unsafe pathname');
      }
      break;
    }
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
    let decoded;
    try {
      decoded = decodeURIComponent(current.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch {
      throw new DynamicRouteValidationError('getStaticPaths() generated an unsafe pathname');
    }
    const decodedSegmentCount = decoded.split('/').length;
    if (decodedSegmentCount !== segmentCount) {
      throw new DynamicRouteValidationError('getStaticPaths() generated an unsafe pathname');
    }
    current = decoded;
    segmentCount = decodedSegmentCount;
  }
}

/** @param {'startup'|'hot'} mode */
function inventoryError(mode) {
  return new RuntimeDynamicRouteDiscoveryError(
    '',
    mode === 'hot'
      ? 'the experimental route inventory is unavailable; use pages.devDynamicDiscovery: "startup"'
      : 'the development route inventory is unavailable',
  );
}

/** @param {string} route */
function safeRouteLabel(route) {
  if (typeof route !== 'string') return '';
  const clean = route.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!clean.startsWith('/')) return '';
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}
