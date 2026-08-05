export function GET() {
  return new Response(
    '<!doctype html><html><head><title>Created</title></head><body><main><h1>Created</h1></main></body></html>',
    {
      status: 201,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-created': 'preserved',
      },
    },
  );
}
