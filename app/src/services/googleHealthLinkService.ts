import { getAuthInstance } from '../firebase';

interface GoogleHealthLinkErrorOptions {
  code: string;
  status?: number;
  retryable?: boolean;
  requestId?: string;
}

export class GoogleHealthLinkError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly requestId?: string;

  constructor(message: string, options: GoogleHealthLinkErrorOptions) {
    super(message);
    this.name = 'GoogleHealthLinkError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function responseRequestId(response: Response, payload: Record<string, unknown>): string | undefined {
  if (typeof payload.requestId === 'string' && payload.requestId.length > 0) {
    return payload.requestId;
  }
  return response.headers.get('X-Request-ID') ?? undefined;
}

export const googleHealthLinkService = {
  /**
   * Starts the Google Health OAuth linking flow: asks the server for a consent-screen
   * URL (with a one-time CSRF state token tied to this app account), then navigates the
   * browser there directly -- unlike Garmin linking, this is a real redirect, not a
   * request/response exchange, because Google's consent screen has to run in the user's
   * own browser session.
   *
   * The user will see Google's "unverified app" warning (CASA/Restricted Scope
   * verification is not yet complete -- see docs/plans/2026-08-27-real-google-health-ingestion.md)
   * and needs to click through Advanced -> Go to (unsafe) -> Allow.
   */
  async startLink(): Promise<void> {
    const currentUser = getAuthInstance().currentUser;
    if (!currentUser) {
      throw new GoogleHealthLinkError('Your app session expired. Sign in again first.', {
        code: 'google_health_link.app_session_expired',
        retryable: false,
      });
    }

    let response: Response;
    try {
      response = await fetch('/api/google-health/start-link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await currentUser.getIdToken()}` },
      });
    } catch {
      throw new GoogleHealthLinkError(
        'Google Health linking service could not be reached. Check your connection and try again.',
        { code: 'google_health_link.network', retryable: true },
      );
    }

    const payload = asRecord(await response.json().catch(() => null));
    const requestId = responseRequestId(response, payload);

    if (!response.ok || typeof payload.authorizeUrl !== 'string') {
      const message = typeof payload.error === 'string'
        ? payload.error
        : 'Could not start Google Health linking.';
      const code = typeof payload.errorCode === 'string'
        ? payload.errorCode
        : `google_health_link.http_${response.status}`;
      const retryable = typeof payload.retryable === 'boolean'
        ? payload.retryable
        : response.status === 429 || response.status >= 500;
      throw new GoogleHealthLinkError(message, { code, status: response.status, retryable, requestId });
    }

    window.location.href = payload.authorizeUrl;
  },
};
