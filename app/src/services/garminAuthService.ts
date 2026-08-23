import { getAuthInstance } from '../firebase';

export type GarminAuthResult =
  | { status: 'mfa_required'; challengeId: string }
  | { status: 'authenticated'; customToken: string; isNewUser: boolean };

export interface LegacyAccountMigrationResult {
  status: 'migrated';
  documentsCopied: number;
  collectionsCopied: number;
  syncQueued: boolean;
}

async function parseResponse(response: Response): Promise<GarminAuthResult> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'Garmin authentication failed.';
    throw new Error(message);
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
  throw new Error('Garmin authentication returned an unexpected response.');
}

async function parseMigrationResponse(response: Response): Promise<LegacyAccountMigrationResult> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'Account migration failed.';
    throw new Error(message);
  }
  if (
    payload.status === 'migrated'
    && typeof payload.documentsCopied === 'number'
    && typeof payload.collectionsCopied === 'number'
    && typeof payload.syncQueued === 'boolean'
  ) {
    return {
      status: 'migrated',
      documentsCopied: payload.documentsCopied,
      collectionsCopied: payload.collectionsCopied,
      syncQueued: payload.syncQueued,
    };
  }
  throw new Error('Account migration returned an unexpected response.');
}

export const garminAuthService = {
  async startLogin(email: string, password: string, linkCurrentUser = false): Promise<GarminAuthResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (linkCurrentUser) {
      const currentUser = getAuthInstance().currentUser;
      if (!currentUser) throw new Error('Your app session expired. Sign in again first.');
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }
    const response = await fetch('/api/garmin/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    return parseResponse(response);
  },

  async completeMfa(challengeId: string, code: string): Promise<GarminAuthResult> {
    const response = await fetch('/api/garmin/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code }),
    });
    return parseResponse(response);
  },

  async migrateLegacyUserData(sourceIdToken: string): Promise<LegacyAccountMigrationResult> {
    const currentUser = getAuthInstance().currentUser;
    if (!currentUser) throw new Error('Your app session expired. Sign in again first.');
    const response = await fetch('/api/garmin/migrate-user-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await currentUser.getIdToken()}`,
      },
      body: JSON.stringify({ sourceIdToken }),
    });
    return parseMigrationResponse(response);
  },
};
