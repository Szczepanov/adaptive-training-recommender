import { getErrorMessage } from './errors';

export type PresetMessage = {
  text: string;
  failed: boolean;
};

/**
 * Turn the two Health + Running + Yoga preset writes' settled results (plus whether the
 * caller's post-apply refresh also failed) into the message shown to the user.
 *
 * A write failure always takes priority, since it is the thing the user must act on
 * (reapply). A refresh failure only matters when both writes succeeded: it must not be
 * reported as a preset failure -- the preset *did* apply -- and it must not silently
 * overwrite the partial-save message either.
 *
 * Factored out of HealthRunYogaPresetSection so it's directly testable: this repo has no
 * interactive component-test harness (no @testing-library/react), see
 * GarminSyncNowButton.test.tsx / garminSyncStaleness.ts for the established pattern.
 */
export function derivePresetOutcome(
  results: PromiseSettledResult<unknown>[],
  refreshFailed: boolean,
): PresetMessage {
  const fulfilledCount = results.filter((result) => result.status === 'fulfilled').length;
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (rejected) {
    const detail = getErrorMessage(rejected.reason) || 'One preset save failed.';
    return {
      text:
        fulfilledCount > 0
          ? `The preset was only partly applied: ${detail} Reapply it to complete setup.`
          : detail,
      failed: true,
    };
  }

  return {
    text: refreshFailed
      ? 'Health + Running + Yoga preset applied. Reload to see the latest settings.'
      : 'Health + Running + Yoga preset applied. Review and save any further edits below.',
    failed: false,
  };
}
