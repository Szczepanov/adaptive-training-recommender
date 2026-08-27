import { getAuthInstance } from '../firebase';

export type GarminAuthResult =
  | { status: 'mfa_required'; challengeId: string }
  | { status: 'authenticated'; customToken: string; isNewUser: boolean };

export interface GarminConnectionStatus {
  status: 'active' | 'disconnected';
  linkedAt?: string;
}

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

function responseError(
  response: Response,
  payload: Record<string, unknown>,
  fallbackMessage: string,
): GarminAuthError {
  const message = typeof payload.error === 'string' ? payload.error : fallbackMessage;
  const code = typeof payload.errorCode === 'string'
    ? payload.errorCode
    : `garmin_link.http_${response.status}`;
  const retryable = typeof payload.retryable === 'boolean'
    ? payload.retryable
    : response.status === 429 || response.status >= 500;
  return new GarminAuthError(message, {
    code,
    status: response.status,
    retryable,
    requestId: responseRequestId(response, payload),
  });
}

async function parseResponse(response: Response): Promise<GarminAuthResult> {
  const payload = asRecord(await response.json().catch(() => null));
  const requestId = responseRequestId(response, payload);

  if (!response.ok) {
    throw responseError(response, payload, 'Garmin authentication failed.');
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

async function appAuthorizationHeader(): Promise<Record<string, string>> {
  const currentUser = getAuthInstance().currentUser;
  if (!currentUser) {
    throw new GarminAuthError('Your app session expired. Sign in again first.', {
      code: 'garmin_link.app_session_expired',
      retryable: false,
    });
  }
  return { Authorization: `Bearer ${await currentUser.getIdToken()}` };
}

async function parseConnectionStatus(response: Response): Promise<GarminConnectionStatus> {
  const payload = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    throw responseError(response, payload, 'Could not verify Garmin connection status.');
  }

  if (payload.status === 'disconnected') {
    return { status: 'disconnected' };
  }
  if (payload.status === 'active') {
    return {
      status: 'active',
      linkedAt: typeof payload.linkedAt === 'string' ? payload.linkedAt : undefined,
    };
  }

  throw new GarminAuthError('Garmin status returned an unexpected response.', {
    code: 'garmin_link.invalid_status_response',
    status: response.status,
    retryable: false,
    requestId: responseRequestId(response, payload),
  });
}

export const garminAuthService = {
  async getConnectionStatus(): Promise<GarminConnectionStatus> {
    const response = await request('/api/garmin/status', {
      method: 'POST',
      headers: await appAuthorizationHeader(),
    });
    return parseConnectionStatus(response);
  },

  async startLogin(email: string, password: string, linkCurrentUser = false): Promise<GarminAuthResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (linkCurrentUser) {
      Object.assign(headers, await appAuthorizationHeader());
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
