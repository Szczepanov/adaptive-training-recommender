import { getAuthInstance } from '../firebase';

export type GarminAuthResult =
  | { status: 'mfa_required'; challengeId: string }
  | { status: 'authenticated'; customToken: string; isNewUser: boolean };

interface GarminErrorOptions {
  code: string;
  status?: number;
  retryable?: boolean;
  requestId?: string;
}

export class GarminAuthError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly requestId?: string;

  constructor(message: string, options: GarminErrorOptions) {
    super(message);
    this.name = 'GarminAuthError';
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

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new GarminAuthError(
      'Garmin linking service could not be reached. Check your connection and try again.',
      {
        code: 'garmin_link.network',
        retryable: true,
      },
    );
  }
}

async function parseResponse(response: Response): Promise<GarminAuthResult> {
  const payload = asRecord(await response.json().catch(() => null));
  const requestId = responseRequestId(response, payload);

  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : 'Garmin authentication failed.';
    const code = typeof payload.errorCode === 'string'
      ? payload.errorCode
      : `garmin_link.http_${response.status}`;
    const retryable = typeof payload.retryable === 'boolean'
      ? payload.retryable
      : response.status === 429 || response.status >= 500;
    throw new GarminAuthError(message, {
      code,
      status: response.status,
      retryable,
      requestId,
    });
  }

  if (payload.status === 'mfa_required' && typeof payload.challengeId === 'string') {
    return { status: 'mfa_required', challengeId: payload.challengeId };
  }
  if (
    payload.status === 'authenticated'
    && typeof payload.customToken === 'string'
    && typeof payload.isNewUser === 'boolean'
  ) {
    return {
      status: 'authenticated',
      customToken: payload.customToken,
      isNewUser: payload.isNewUser,
    };
  }
  throw new GarminAuthError('Garmin authentication returned an unexpected response.', {
    code: 'garmin_link.invalid_response',
    status: response.status,
    retryable: false,
    requestId,
  });
}

export const garminAuthService = {
  async startLogin(email: string, password: string, linkCurrentUser = false): Promise<GarminAuthResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (linkCurrentUser) {
      const currentUser = getAuthInstance().currentUser;
      if (!currentUser) {
        throw new GarminAuthError('Your app session expired. Sign in again first.', {
          code: 'garmin_link.app_session_expired',
          retryable: false,
        });
      }
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }
    const response = await request('/api/garmin/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    return parseResponse(response);
  },

  async completeMfa(challengeId: string, code: string): Promise<GarminAuthResult> {
    const response = await request('/api/garmin/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code }),
    });
    return parseResponse(response);
  },
};
