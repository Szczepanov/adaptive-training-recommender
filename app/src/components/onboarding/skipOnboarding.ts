import { dismissOnboardingForUser } from '../../utils/onboardingStorage';
import { getLocalDateString } from '../../utils/localDate';
import { usabilityMetrics, type OnboardingWizardStage } from '../../utils/usabilityMetrics';

/**
 * Explicit dismissal action kept separate from the Firestore-writing completion path.
 * This narrow seam is intentionally testable so Skip cannot regress into a partial setup
 * write when onboarding evolves.
 */
export function skipOnboardingForNow(
  userId: string,
  stage: OnboardingWizardStage,
  elapsedMs: number | undefined,
  onCompleted: () => void,
): void {
  dismissOnboardingForUser(userId);
  usabilityMetrics.recordWizardCompleted(userId, getLocalDateString(), 'skipped', elapsedMs, stage);
  onCompleted();
}
