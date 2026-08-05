export function GET() {
  return new Response('LITERAL-MD-ENDPOINT', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-literal-md': 'project' },
  });
}
