import { dismissOnboardingForUser } from '../../utils/onboardingStorage';
import { getLocalDateString } from '../../utils/localDate';
import { usabilityMetrics, type OnboardingWizardStage } from '../../utils/usabilityMetrics';

function recordOnboardingSkip(
  userId: string,
  stage: OnboardingWizardStage,
  elapsedMs: number | undefined,
): void {
  usabilityMetrics.recordWizardCompleted(userId, getLocalDateString(), 'skipped', elapsedMs, stage);
}

/**
 * Explicit dismissal action kept separate from the Firestore-writing completion path.
 * This narrow seam is intentionally testable so Skip cannot regress into a partial setup
 * write when onboarding evolves. Returns whether the dismissal persisted. A false result
 * means browser storage is blocked, so neither completion telemetry nor `onCompleted` fires:
 * the wizard is still open and the athlete has not completed the skip yet (#493).
 */
export function skipOnboardingForNow(
  userId: string,
  stage: OnboardingWizardStage,
  elapsedMs: number | undefined,
  onCompleted: () => void,
): boolean {
  const persisted = dismissOnboardingForUser(userId);
  if (!persisted) return false;

  recordOnboardingSkip(userId, stage, elapsedMs);
  onCompleted();
  return true;
}

/**
 * Explicitly accepts a session-only dismissal after durable browser storage was unavailable.
 * The skip is now complete from the athlete's perspective, so record it once and dismiss the
 * wizard without pretending that a durable dismissal key was written.
 */
export function continueOnboardingSkipForSessionOnly(
  userId: string,
  stage: OnboardingWizardStage,
  elapsedMs: number | undefined,
  onCompleted: () => void,
): void {
  recordOnboardingSkip(userId, stage, elapsedMs);
  onCompleted();
}
