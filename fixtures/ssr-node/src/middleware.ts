import { defineMiddleware } from 'astro:middleware';

// The project's own auth. A .md request rewrites into the underlying route, so
// this must run for /gated.md exactly as it does for /gated/.
export const onRequest = defineMiddleware(async (context, next) => {
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
});
