const HTML = '<!doctype html><html><head><title>Adapter Transport</title></head><body><main><h1>Adapter Transport</h1></main></body></html>';
const GZIP_HTML = new Uint8Array([
  31, 139, 8, 0, 0, 0, 0, 0, 0, 19, 179, 81, 76, 201, 79, 46, 169, 44,
  72, 85, 200, 40, 201, 205, 177, 179, 129, 146, 169, 137, 41, 118, 54, 37,
  153, 37, 57, 169, 118, 174, 121, 201, 249, 41, 169, 41, 54, 250, 16, 174,
  141, 62, 68, 50, 41, 63, 165, 210, 206, 38, 55, 49, 51, 15, 168, 220, 16,
  161, 10, 200, 182, 209, 135, 8, 235, 67, 212, 232, 131, 205, 4, 0, 124, 148,
  194, 96, 105, 0, 0, 0,
]);

/** @param {Request} request @returns {Response | null} */
export function transportResponse(request) {
  const transport = new URL(request.url).searchParams.get('transport');
  if (transport === 'mixed-content-type') {
    return new Response(HTML, { headers: { 'content-type': 'Text/HTML; Charset=UTF-8' } });
  }
  if (transport === 'partial') {
    if (request.headers.has('range')) {
      return new Response('<html><main>adapter partial bytes</main></html>', {
        status: 206,
        headers: {
          'accept-ranges': 'bytes',
          'content-range': 'bytes 0-9/100',
          'content-type': 'text/html; charset=utf-8',
          etag: '"adapter-partial-source"',
        },
      });
    }
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (transport === 'forced-partial') {
    return new Response('<html><main>adapter forced partial bytes</main></html>', {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': 'bytes 0-19/100',
        'content-type': 'text/html; charset=utf-8',
        etag: '"adapter-forced-partial-source"',
      },
    });
  }
  if (transport === 'compressed') {
    return new Response(GZIP_HTML.slice(), {
      headers: {
        'content-encoding': 'gzip',
        'content-type': 'text/html; charset=utf-8',
        etag: '"adapter-compressed-source"',
      },
    });
  }
  if (transport === 'metadata') {
    return new Response(HTML, {
      headers: {
        'accept-ranges': 'bytes',
        'content-digest': 'sha-256=:stale:',
        'content-md5': 'stale-md5',
        'content-range': 'bytes 0-9/100',
        'content-type': 'text/html; charset=utf-8',
        digest: 'sha-256=stale',
        etag: '"adapter-stale-source"',
        'repr-digest': 'sha-256=:stale:',
      },
    });
  }
  if (transport === 'redirect-body') {
    const body = 'Adapter redirect response body.';
    return new Response(body, {
      status: 302,
      headers: {
        'content-digest': 'sha-256=:adapter-redirect-body:',
        'content-length': String(new TextEncoder().encode(body).length),
        'content-type': 'text/plain; charset=utf-8',
        location: '/docs/about/?from=body',
      },
    });
  }
  return null;
}
