import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GarminAuthError, garminAuthService } from './garminAuthService';

const mockGetIdToken = vi.fn();

vi.mock('../firebase', () => ({
  getAuthInstance: vi.fn(() => ({
    currentUser: {
      getIdToken: mockGetIdToken,
    },
  })),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockGetIdToken.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('garminAuthService', () => {
  it('preserves structured server diagnostics for failed requests', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'Garmin is rate limiting login attempts. Try again later.',
      errorCode: 'garmin_link.rate_limited',
      retryable: true,
      requestId: 'req-123',
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toMatchObject({
      name: 'GarminAuthError',
      message: 'Garmin is rate limiting login attempts. Try again later.',
      code: 'garmin_link.rate_limited',
      status: 429,
      retryable: true,
      requestId: 'req-123',
    });
  });

  it('uses the response header as a request reference when the body omits it', async () => {
    mockFetch.mockResolvedValue(new Response('not-json', {
      status: 502,
      headers: { 'X-Request-ID': 'req-header' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toMatchObject({
      code: 'garmin_link.http_502',
      status: 502,
      retryable: true,
      requestId: 'req-header',
    });
  });

  it('classifies transport failures without exposing the raw fetch exception', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch https://internal.example/token'));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toEqual(
      expect.objectContaining({
        name: 'GarminAuthError',
        code: 'garmin_link.network',
        retryable: true,
        message: 'Garmin linking service could not be reached. Check your connection and try again.',
      }),
    );
  });

  it('returns successful authentication payloads unchanged', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      status: 'authenticated',
      customToken: 'firebase-custom-token',
      isNewUser: false,
    }), { status: 200 }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).resolves.toEqual({
      status: 'authenticated',
      customToken: 'firebase-custom-token',
      isNewUser: false,
    });
  });

  it('rejects a successful HTTP response with an invalid application payload', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'unknown' }), {
      status: 200,
      headers: { 'X-Request-ID': 'req-invalid' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toEqual(
      expect.objectContaining<Partial<GarminAuthError>>({
        code: 'garmin_link.invalid_response',
        status: 200,
        retryable: false,
        requestId: 'req-invalid',
      }),
    );
  });
});
