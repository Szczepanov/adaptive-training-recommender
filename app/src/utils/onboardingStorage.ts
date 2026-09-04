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
