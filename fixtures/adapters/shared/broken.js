export function GET() {
  return new Response(
    '<!doctype html><html><head><title>Adapter Broken</title></head><body><main><h1>Adapter Broken</h1></main></body></html>',
    { status: 500, headers: { 'content-type': 'text/html; charset=utf-8', 'x-error': 'preserved' } },
  );
}
