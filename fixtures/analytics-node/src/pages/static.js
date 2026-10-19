export const prerender = true;
export function GET() {
  return new Response('<html><body><h1>Static endpoint</h1></body></html>', { headers: { 'content-type': 'text/html' } });
}
