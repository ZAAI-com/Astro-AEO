import { defineMiddleware } from 'astro:middleware';

let activeCorpusRequests = 0;
let peakCorpusRequests = 0;
const corpusRequests: Array<{
  pathname: string;
  hasAuthorization: boolean;
  hasCookie: boolean;
  hasXToken: boolean;
  accept: string | null;
  acceptEncoding: string | null;
  range: string | null;
  hasInternalToken: boolean;
  hasLeakedLocal: boolean;
  hasLeakedCookie: boolean;
}> = [];

// The project's own auth. A .md request rewrites into the underlying route, so
// this must run for /gated.md exactly as it does for /gated/.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname === '/__aeo-runtime-probe') {
    if (context.url.searchParams.has('reset')) {
      activeCorpusRequests = 0;
      peakCorpusRequests = 0;
      corpusRequests.length = 0;
    }
    return Response.json({ activeCorpusRequests, peakCorpusRequests, corpusRequests });
  }

  const corpusRequest =
    context.request.headers.get('x-astro-aeo-internal-purpose') === 'corpus';
  if (corpusRequest) {
    activeCorpusRequests++;
    peakCorpusRequests = Math.max(peakCorpusRequests, activeCorpusRequests);
    corpusRequests.push({
      pathname: context.url.pathname,
      hasAuthorization: context.request.headers.has('authorization'),
      hasCookie: context.request.headers.has('cookie'),
      hasXToken: context.request.headers.has('x-token'),
      accept: context.request.headers.get('accept'),
      acceptEncoding: context.request.headers.get('accept-encoding'),
      range: context.request.headers.get('range'),
      hasInternalToken: context.request.headers.has('x-astro-aeo-internal'),
      hasLeakedLocal: Boolean((context.locals as Record<string, unknown>).corpusPageUser),
      hasLeakedCookie: Boolean(context.cookies.get('corpus-page-user')),
    });
    (context.locals as Record<string, unknown>).corpusPageUser =
      'must-not-reach-the-next-page';
    context.cookies.set('corpus-page-user', 'must-not-reach-the-next-page');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  try {
    if (
      context.url.pathname === '/about/' &&
      context.url.searchParams.has('set-source-cookie')
    ) {
      context.cookies.set('direct-source-cookie', 'preserved', { path: '/' });
    }
    if (context.url.pathname.startsWith('/gated')) {
      if (context.request.headers.get('x-token') !== 'letmein') {
        return new Response('forbidden', { status: 403 });
      }
    }
    const response = await next();
    if (context.url.pathname.startsWith('/about')) {
      response.headers.set('cache-control', 'private, max-age=30');
      response.headers.set('vary', 'Origin');
      response.headers.set('content-language', 'en');
      response.headers.set('x-app-trace', 'preserved');
      response.headers.append('set-cookie', 'representation=test; Path=/; HttpOnly');
    }
    return response;
  } finally {
    if (corpusRequest) activeCorpusRequests--;
  }
});
