export function GET() {
  return new Response(
    '<!doctype html><html><head><title>Broken</title></head><body><main><h1>Broken</h1><p>Failure detail.</p></main></body></html>',
    { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
