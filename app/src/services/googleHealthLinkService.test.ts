import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleHealthLinkService } from './googleHealthLinkService';

const mockGetIdToken = vi.fn();
const mockGetAuthInstance = vi.fn();

vi.mock('../firebase', () => ({
  getAuthInstance: () => mockGetAuthInstance(),
}));

const mockFetch = vi.fn();
// This suite runs under vitest's default `node` test environment (no real `window` global,
// confirmed: other test files in this project never reference `window` either) -- stub a
// minimal one rather than pulling in jsdom just for this one navigation assertion.
const fakeWindow = { location: { href: '' } };

beforeEach(() => {
  mockFetch.mockReset();
  mockGetIdToken.mockReset();
  mockGetIdToken.mockResolvedValue('fake-id-token');
  mockGetAuthInstance.mockReset();
  mockGetAuthInstance.mockReturnValue({ currentUser: { getIdToken: mockGetIdToken } });
  vi.stubGlobal('fetch', mockFetch);
  fakeWindow.location.href = '';
  vi.stubGlobal('window', fakeWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('googleHealthLinkService.startLink', () => {
  it('sends the Firebase bearer token and navigates to the returned authorizeUrl on success', async () => {
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await googleHealthLinkService.startLink();

    expect(mockFetch).toHaveBeenCalledWith('/api/google-health/start-link', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-id-token' },
    });
    expect(fakeWindow.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=abc');
  });

  it('throws without calling fetch when there is no signed-in user', async () => {
    mockGetAuthInstance.mockReturnValue({ currentUser: null });

    await expect(googleHealthLinkService.startLink()).rejects.toMatchObject({
      name: 'GoogleHealthLinkError',
      code: 'google_health_link.app_session_expired',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('preserves structured server diagnostics for failed requests', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'Server misconfiguration: GOOGLE_HEALTH_CLIENT_ID is not set.',
      errorCode: 'google_health_link.validation',
      retryable: false,
      requestId: 'req-123',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(googleHealthLinkService.startLink()).rejects.toMatchObject({
      name: 'GoogleHealthLinkError',
      message: 'Server misconfiguration: GOOGLE_HEALTH_CLIENT_ID is not set.',
      code: 'google_health_link.validation',
      status: 400,
      retryable: false,
      requestId: 'req-123',
    });
  });

  it('classifies transport failures without exposing the raw fetch exception', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch https://internal.example/'));

    await expect(googleHealthLinkService.startLink()).rejects.toEqual(
      expect.objectContaining({
        name: 'GoogleHealthLinkError',
        code: 'google_health_link.network',
        retryable: true,
      }),
    );
  });

  it('treats a response missing authorizeUrl as a failure even with HTTP 200', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(googleHealthLinkService.startLink()).rejects.toMatchObject({
      name: 'GoogleHealthLinkError',
    });
  });
});
