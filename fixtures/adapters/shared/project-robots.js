export function GET() {
  return new Response('PROJECT-ROBOTS\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
