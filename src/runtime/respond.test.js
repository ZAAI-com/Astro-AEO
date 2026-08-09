import { describe, expect, test, vi } from 'vitest';
import {
  cancelResponseBody,
  inheritedRepresentationHeaders,
  isHtmlResponse,
  isIdentityEncoded,
  isNullBodyStatus,
  isUtf8HtmlResponse,
  responseBodyForbidden,
  textResponse,
  transformedHtmlContentType,
} from './respond.js';

describe('bodyless response handling', () => {
  test.each([204, 205, 304])('recognizes null-body status %s', (status) => {
    expect(isNullBodyStatus(status)).toBe(true);
  });

  test.each([204, 205])('does not give status %s a generated body', async (status) => {
    const response = await textResponse({
      body: 'generated representation',
      contentType: 'text/plain; charset=utf-8',
      request: new Request('https://example.test/'),
      status,
    });

    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  });

  test('HEAD forbids a body independently of status', () => {
    expect(
      responseBodyForbidden(
        new Request('https://example.test/', { method: 'HEAD' }),
        200,
      ),
    ).toBe(true);
  });
});

describe('generated representation metadata', () => {
  test('turns a transformed 206 into a complete 200 representation', async () => {
    const response = await textResponse({
      body: 'complete generated representation',
      contentType: 'text/markdown; charset=utf-8',
      request: new Request('https://example.test/page.md'),
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'cache-control': 'private',
        'content-digest': 'sha-256=:stale:',
        'content-range': 'bytes 0-4/100',
        'content-encoding': 'gzip',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('complete generated representation');
    expect(response.headers.get('cache-control')).toBe('private');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    for (const name of ['accept-ranges', 'content-digest', 'content-range', 'content-encoding']) {
      expect(response.headers.get(name), name).toBeNull();
    }
  });

  test('drops stale integrity fields while preserving response policy', () => {
    const source = new Response('source', {
      headers: {
        'cache-control': 'public, max-age=60',
        'content-digest': 'sha-256=:old:',
        'repr-digest': 'sha-256=:old:',
        digest: 'sha-256=old',
        'content-md5': 'old',
        'x-app': 'preserved',
      },
    });
    const headers = inheritedRepresentationHeaders(source);

    expect(headers.get('cache-control')).toBe('public, max-age=60');
    expect(headers.get('x-app')).toBe('preserved');
    for (const name of ['content-digest', 'repr-digest', 'digest', 'content-md5']) {
      expect(headers.get(name), name).toBeNull();
    }
  });
});

describe('source representation classification', () => {
  test('matches HTML media types exactly and case-insensitively', () => {
    expect(isHtmlResponse(new Response('', { headers: { 'content-type': 'Text/HTML; Charset=UTF-8' } }))).toBe(true);
    expect(isHtmlResponse(new Response('', { headers: { 'content-type': 'application/xhtml+xml' } }))).toBe(true);
    expect(isHtmlResponse(new Response('', { headers: { 'content-type': 'application/nothtml' } }))).toBe(false);
  });

  test('labels transformed HTML strings with their actual UTF-8 encoding', () => {
    expect(transformedHtmlContentType(new Response('', {
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
    }))).toBe('text/html; charset=utf-8');
    expect(transformedHtmlContentType(new Response('', {
      headers: { 'content-type': 'application/xhtml+xml; charset=utf-16' },
    }))).toBe('application/xhtml+xml; charset=utf-8');
  });

  test('only treats absent or explicit identity content coding as transformable', () => {
    expect(isIdentityEncoded(new Response('plain'))).toBe(true);
    expect(isIdentityEncoded(new Response('plain', { headers: { 'content-encoding': 'IDENTITY' } }))).toBe(true);
    expect(isIdentityEncoded(new Response('compressed', { headers: { 'content-encoding': 'gzip' } }))).toBe(false);
  });

  test('only decodes HTML whose charset is absent or UTF-8', () => {
    expect(isUtf8HtmlResponse(new Response('', {
      headers: { 'content-type': 'text/html' },
    }))).toBe(true);
    expect(isUtf8HtmlResponse(new Response('', {
      headers: { 'content-type': 'Text/HTML; Charset="UTF-8"' },
    }))).toBe(true);
    expect(isUtf8HtmlResponse(new Response('', {
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
    }))).toBe(false);
    expect(isUtf8HtmlResponse(new Response('', {
      headers: { 'content-type': 'text/html; charset=' },
    }))).toBe(false);
  });

  test('cancels an unread response body at most once', () => {
    const response = new Response('unused');
    const cancel = vi.spyOn(response.body, 'cancel').mockResolvedValue();
    cancelResponseBody(response);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
