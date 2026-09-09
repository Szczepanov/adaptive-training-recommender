import type { DailySubjectiveCheckin } from '../../engine/models';

export type CheckinStepId = 'followups' | 'recovery' | 'safety' | 'availability';

export type CheckinStepStatus = 'done' | 'pending';

export interface CheckinStepState {
  id: CheckinStepId;
  label: string;
  status: CheckinStepStatus;
  detail: string;
}

export const CHECKIN_STEP_LABELS: Record<CheckinStepId, string> = {
  followups: 'Follow-ups',
  recovery: 'Recovery',
  safety: 'Safety',
  availability: 'Availability',
};

const RECOVERY_KEYS = [
  'readiness',
  'sleepQuality',
  'fatigue',
  'soreness',
  'mentalStress',
  'motivation',
] as const;

const SAFETY_FLAGS = [
  'painOrInjury',
  'illnessSymptoms',
  'unusuallyLimitedTime',
  'alreadyTrainedToday',
] as const;

/**
 * Derives the four check-in header steps from the last persisted daily document.
 * Pure and read-only: it never writes, never scores, and never feeds the engine --
 * `subjectiveBaseline.ts` keeps its own fully-scored-day authority untouched.
 *
 * The caller deliberately supplies the persisted snapshot rather than the editable
 * form draft. This keeps the header honest: entering a value is not the same thing as
 * saving it, and Back/Skip must never make an unsaved draft look persisted.
 */
export function deriveCheckinSteps(
  savedCheckin: Partial<DailySubjectiveCheckin> | null,
  pendingFollowupCount: number,
): CheckinStepState[] {
  const savedRecoveryCount = savedCheckin
    ? RECOVERY_KEYS.filter(key => typeof savedCheckin[key] === 'number').length
    : 0;
  const savedSafetyCount = savedCheckin
    ? SAFETY_FLAGS.filter(flag => savedCheckin[flag] !== undefined).length
    : 0;
  const savedTimeAvailable = savedCheckin?.availability?.timeAvailableMin ?? null;

  return [
    {
      id: 'followups',
      label: CHECKIN_STEP_LABELS.followups,
      status: pendingFollowupCount === 0 ? 'done' : 'pending',
      detail: pendingFollowupCount === 0 ? 'Complete' : `${pendingFollowupCount} to review`,
    },
    {
      id: 'recovery',
      label: CHECKIN_STEP_LABELS.recovery,
      status: savedRecoveryCount === RECOVERY_KEYS.length ? 'done' : 'pending',
      detail: `${savedRecoveryCount}/${RECOVERY_KEYS.length} saved`,
    },
    {
      id: 'safety',
      label: CHECKIN_STEP_LABELS.safety,
      status: savedSafetyCount === SAFETY_FLAGS.length ? 'done' : 'pending',
      detail:
        savedSafetyCount === SAFETY_FLAGS.length
          ? 'Complete'
          : `${savedSafetyCount}/${SAFETY_FLAGS.length} saved`,
    },
    {
      id: 'availability',
      label: CHECKIN_STEP_LABELS.availability,
      status: savedTimeAvailable === null ? 'pending' : 'done',
      detail: savedTimeAvailable === null ? 'Not saved' : `${savedTimeAvailable} min saved`,
    },
  ];
}
