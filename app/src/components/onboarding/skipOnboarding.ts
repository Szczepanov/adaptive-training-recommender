import { dismissOnboardingForUser } from '../../utils/onboardingStorage';
import { getLocalDateString } from '../../utils/localDate';
import { usabilityMetrics, type OnboardingWizardStage } from '../../utils/usabilityMetrics';

/**
 * Explicit dismissal action kept separate from the Firestore-writing completion path.
 * This narrow seam is intentionally testable so Skip cannot regress into a partial setup
 * write when onboarding evolves. Returns whether the dismissal persisted: false means
 * browser storage is blocked, the dismissal is session-only, and the wizard may
 * resurface on refresh (#493).
 */
export function skipOnboardingForNow(
  userId: string,
  stage: OnboardingWizardStage,
  elapsedMs: number | undefined,
  onCompleted: () => void,
): boolean {
  const persisted = dismissOnboardingForUser(userId);
  usabilityMetrics.recordWizardCompleted(userId, getLocalDateString(), 'skipped', elapsedMs, stage);
  onCompleted();
  return persisted;
}
