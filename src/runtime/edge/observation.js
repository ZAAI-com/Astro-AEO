// @ts-check
/** Optional injection does not import analytics into disabled provider bundles.
 * @param {import('../../analytics.js').AnalyticsObserver | undefined} observer
 * @param {Request} request @param {Response} response
 * @param {import('../../analytics.js').AnalyticsObservation} details
 */
export function observeEdge(observer, request, response, details) {
  try { observer?.observe(request, response, details); } catch { /* Injected failures never change HTTP. */ }
  return response;
}
