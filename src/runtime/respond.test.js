import { describe, expect, test } from 'vitest';
import { isNullBodyStatus, responseBodyForbidden, textResponse } from './respond.js';

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
