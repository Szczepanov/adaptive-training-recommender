export function getOnboardingDoneStorageKey(userId: string): string {
  return `adaptive_training_onboarding_done_${userId}`;
}

export function isOnboardingDismissedForUser(userId: string | null): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(getOnboardingDoneStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists wizard dismissal for one user WITHOUT creating a goal or touching
 * training settings. Returns false when browser storage is unavailable, so the
 * caller knows the dismissal is session-only and the wizard may resurface.
 */
export function dismissOnboardingForUser(userId: string | null): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(getOnboardingDoneStorageKey(userId), 'true');
    return true;
  } catch {
    return false;
  }
}

/** Clears a stored dismissal so a goal-less account can re-launch the wizard. */
export function clearOnboardingDismissalForUser(userId: string | null): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getOnboardingDoneStorageKey(userId));
  } catch {
    // Non-critical local UI-state failure; the wizard gate also checks active goals.
  }
}
