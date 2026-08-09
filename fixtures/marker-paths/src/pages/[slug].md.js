export function getStaticPaths() {
  return [{ params: { slug: 'about' } }];
}

export function GET() {
  return new Response('project-owned dynamic endpoint\n', {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}
