import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getOnboardingDoneStorageKey, isOnboardingDismissedForUser } from './onboardingStorage';

describe('onboardingStorage user isolation', () => {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates distinct localStorage keys for different user IDs', () => {
    const keyUser1 = getOnboardingDoneStorageKey('firebase-uid-a');
    const keyUser2 = getOnboardingDoneStorageKey('firebase-uid-b');

    expect(keyUser1).toBe('adaptive_training_onboarding_done_firebase-uid-a');
    expect(keyUser2).toBe('adaptive_training_onboarding_done_firebase-uid-b');
    expect(keyUser1).not.toBe(keyUser2);
  });

  it('returns false for null or empty user IDs', () => {
    expect(isOnboardingDismissedForUser(null)).toBe(false);
    expect(isOnboardingDismissedForUser('')).toBe(false);
  });

  it('returns false when user has not completed or dismissed onboarding', () => {
    expect(isOnboardingDismissedForUser('firebase-uid-new')).toBe(false);
  });

  it('returns true only when the specific user has dismissed onboarding', () => {
    window.localStorage.setItem(getOnboardingDoneStorageKey('firebase-uid-a'), 'true');

    expect(isOnboardingDismissedForUser('firebase-uid-a')).toBe(true);
    expect(isOnboardingDismissedForUser('firebase-uid-b')).toBe(false);
  });

  it('does not treat a newcomer as onboarded when legacy global key exists', () => {
    // Legacy global key without userId
    window.localStorage.setItem('adaptive_training_onboarding_done', 'true');

    // A newly created account must evaluate to false, not true
    expect(isOnboardingDismissedForUser('firebase-uid-newcomer')).toBe(false);
  });

  it('preserves user isolation across multi-user login and logout sequence', () => {
    const userA = 'firebase-uid-account-a';
    const userB = 'firebase-uid-account-b';

    // User A signs up and completes onboarding
    expect(isOnboardingDismissedForUser(userA)).toBe(false);
    window.localStorage.setItem(getOnboardingDoneStorageKey(userA), 'true');
    expect(isOnboardingDismissedForUser(userA)).toBe(true);

    // User A signs out (userId is null)
    expect(isOnboardingDismissedForUser(null)).toBe(false);

    // User B signs up: must NOT inherit User A's onboarding completion
    expect(isOnboardingDismissedForUser(userB)).toBe(false);

    // User B later completes onboarding
    window.localStorage.setItem(getOnboardingDoneStorageKey(userB), 'true');
    expect(isOnboardingDismissedForUser(userB)).toBe(true);
  });
});
