// @ts-check

/**
 * Minimal, dependency-free path glob matcher for URL pathnames.
 *
 * Semantics (segment = text between "/" separators):
 * - `*`   matches within a single segment (never crosses "/")
 * - `**`  matches any number of characters including "/"
 * - `?`   matches a single non-"/" character
 * - `[abc]` / `[a-z]` character classes (within a segment)
 * - everything else is literal
 *
 * Matching is whole-string anchored, so `/error` does NOT match `/error-log`
 * but DOES match `/error` and, via `/error/**`, its descendants.
 */

/**
 * Normalize a pathname or glob for matching: ensure a leading slash and drop a
 * single trailing slash (except for the root "/"). This lets "/error/" and
 * "/error" refer to the same page; match descendants explicitly with "/error/**".
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  let s = p.startsWith('/') ? p : `/${p}`;
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s;
}

/**
 * Convert a single glob string into an anchored RegExp.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  // A trailing "/**" matches the base segment and any descendants:
  //   "/blog/**" matches "/blog", "/blog/post", "/blog/a/b" (but not "/blogging").
  let suffix = '';
  if (glob.endsWith('/**')) {
    glob = glob.slice(0, -3);
    suffix = '(?:/.*)?';
  }

  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` matches any char including "/". Consume an optional trailing slash so
        // that `/blog/**` also matches `/blog` itself.
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        // `*` matches anything but "/"
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      // Character class: copy through to the closing ']'
      let cls = '[';
      i++;
      if (glob[i] === '!' || glob[i] === '^') {
        cls += '^';
        i++;
      }
      while (i < glob.length && glob[i] !== ']') {
        const ch = glob[i];
        cls += /[\\^$.*+?()[\]{}|]/.test(ch) && ch !== '-' ? `\\${ch}` : ch;
        i++;
      }
      cls += ']';
      re += cls;
    } else if (/[\\^$.+()\[\]{}|]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}${suffix}$`);
}

/**
 * Test a pathname against a glob string, an array of globs, or a RegExp.
 * @param {string} pathname
 * @param {string | string[] | RegExp} pattern
 * @returns {boolean}
 */
export function matchPath(pathname, pattern) {
  const path = normalizePath(pathname);
  if (pattern instanceof RegExp) return pattern.test(path);
  const globs = Array.isArray(pattern) ? pattern : [pattern];
  return globs.some((g) => {
    // Preserve "**" globs verbatim (their trailing-slash logic is meaningful);
    // normalize plain trailing slashes so "/error/" matches "/error".
    const g2 = g.includes('*') ? g : normalizePath(g);
    return globToRegExp(g2).test(path);
  });
}

/**
 * True when the pathname is allowed by `include` (default: all) and not
 * blocked by `exclude`.
 * @param {string} pathname
 * @param {{ include?: string[]; exclude?: string[] }} opts
 * @returns {boolean}
 */
export function isIncluded(pathname, { include, exclude } = {}) {
  const inc = include && include.length ? include : ['**'];
  if (!matchPath(pathname, inc)) return false;
  if (exclude && exclude.length && matchPath(pathname, exclude)) return false;
  return true;
}
