export async function onRequest(context, next) {
  if (/\/protected\/?$/.test(context.url.pathname)) {
    if (context.request.headers.get('authorization') !== 'Bearer adapter-secret') {
      return new Response('unauthorized', { status: 401, headers: { 'x-auth': 'required' } });
    }
  }
  const response = await next();
  if (/\/about\/?$/.test(context.url.pathname)) {
    response.headers.set('cache-control', 'private, max-age=45');
    response.headers.set('vary', 'Origin');
    response.headers.set('content-language', 'en');
    response.headers.set('x-adapter-header', 'preserved');
  }
  return response;
}
