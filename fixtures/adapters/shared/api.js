export function GET() {
  return Response.json({ kind: 'adapter-api' }, { headers: { 'x-api': 'preserved' } });
}
