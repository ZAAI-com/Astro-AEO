// @ts-check
import { inspectRootPathname } from '../core/match.js';
import { isVersionGroup } from '../core/page-version.js';

/** Interpret only configured prefixes using public Starlight route data.
 * Both locale/version and version/locale layouts are accepted; no upstream
 * plugin state or source directory discovery enters this boundary.
 * @param {any} route
 * @param {{ current: string; archived: { version: string; prefix: string }[] } | undefined} versions
 */
export function starlightVersion(route, versions) {
  if (!versions || typeof route?.id !== 'string') return {};
  const inspected = inspectRootPathname(`/${route.id.replace(/^\//, '')}`);
  if (!inspected) return {};
  const segments = inspected.decoded.split('/').filter(Boolean);
  const locale = typeof route.locale === 'string' ? route.locale : undefined;
  let localeRemoved = false;
  if (locale && segments[0] === locale) { segments.shift(); localeRemoved = true; }
  const archive = versions.archived.find((entry) => entry.prefix === segments[0]);
  if (archive) segments.shift();
  if (!localeRemoved && locale && segments[0] === locale) segments.shift();
  const group = `/${segments.join('/')}`;
  return { version: archive?.version ?? versions.current,
    ...(isVersionGroup(group) ? { versionGroup: group } : {}) };
}
