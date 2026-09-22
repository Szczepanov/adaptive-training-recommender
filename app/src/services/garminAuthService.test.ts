import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GarminAuthError,
  garminAuthService,
  garminRetrySecondsRemaining,
  scheduleGarminRetryCountdown,
  shouldRetainGarminChallenge,
} from './garminAuthService';

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
  it('counts down until the retry delay ends', () => {
    expect(garminRetrySecondsRemaining(31_000, 1_000)).toBe(30);
    expect(garminRetrySecondsRemaining(31_000, 30_001)).toBe(1);
    expect(garminRetrySecondsRemaining(31_000, 31_000)).toBe(0);
    expect(garminRetrySecondsRemaining(null, 1_000)).toBe(0);
  });

  it('stops countdown updates after the deadline', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const onTick = vi.fn();
      const onComplete = vi.fn();
      const cancel = scheduleGarminRetryCountdown(3_000, onTick, onComplete);

      vi.advanceTimersByTime(2_000);
      expect(onTick).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(10_000);
      expect(onTick).toHaveBeenCalledTimes(2);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains MFA only on explicit pre-authentication reuse authority', () => {
    expect(shouldRetainGarminChallenge(new GarminAuthError('Wait', {
      code: 'garmin_link.rate_limited',
      challengeReusable: true,
      authStage: 'pre_authentication',
    }))).toBe(true);
    expect(shouldRetainGarminChallenge(new GarminAuthError('Wait', {
      code: 'garmin_link.rate_limited', retryable: true,
    }))).toBe(false);
    expect(shouldRetainGarminChallenge(new GarminAuthError('Wait', {
      code: 'garmin_link.rate_limited',
      challengeReusable: false,
      authStage: 'post_authentication',
    }))).toBe(false);
  });
  it('preserves structured server diagnostics for failed requests', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'Garmin is rate limiting login attempts. Try again later.',
      errorCode: 'garmin_link.rate_limited',
      retryable: true,
      retryAfterSeconds: 60,
      requestId: 'req-123',
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toMatchObject({
      name: 'GarminAuthError',
      message: 'Garmin is rate limiting login attempts. Try again later.',
      code: 'garmin_link.rate_limited',
      status: 429,
      retryable: true,
      retryAfterSeconds: 60,
      requestId: 'req-123',
    });
  });

  it('uses a numeric Retry-After header when the body omits retry timing', async () => {
    mockFetch.mockResolvedValue(new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '15' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toMatchObject({
      retryAfterSeconds: 15,
    });
  });

  it('preserves explicit MFA challenge state on a rate limit', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'Try later.',
      retryAfterSeconds: 1800,
      challengeReusable: true,
      authStage: 'pre_authentication',
    }), { status: 429 }));

    await expect(garminAuthService.completeMfa('challenge', '123456')).rejects.toMatchObject({
      retryAfterSeconds: 1800,
      challengeReusable: true,
      authStage: 'pre_authentication',
    });
  });

  it('ignores malformed retry timing', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ retryAfterSeconds: -4 }), {
      status: 429,
      headers: { 'Retry-After': 'not-a-delay' },
    }));

    await expect(garminAuthService.startLogin('athlete@example.com', 'secret')).rejects.toMatchObject({
      retryAfterSeconds: undefined,
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
      expect.objectContaining({
        code: 'garmin_link.invalid_response',
        status: 200,
        retryable: false,
        requestId: 'req-invalid',
      }),
    );
  });
});
