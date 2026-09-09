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
 * Derives the four check-in header steps from the current daily document state.
 * Pure and read-only: it never writes, never scores, and never feeds the engine --
 * `subjectiveBaseline.ts` keeps its own fully-scored-day authority untouched.
 * A step reads as done only when the document actually carries the answers, so a
 * partial save (e.g. a follow-up answer or an incomplete submit) shows exactly
 * what is saved versus still pending.
 */
export function deriveCheckinSteps(
  checkin: Partial<DailySubjectiveCheckin> | null,
  pendingFollowupCount: number,
): CheckinStepState[] {
  const scoredCount = checkin
    ? RECOVERY_KEYS.filter(key => typeof checkin[key] === 'number').length
    : 0;
  const safetyAnsweredCount = checkin
    ? SAFETY_FLAGS.filter(flag => checkin[flag] !== undefined).length
    : 0;
  const timeAvailable = checkin?.availability?.timeAvailableMin ?? null;

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
      status: scoredCount === RECOVERY_KEYS.length ? 'done' : 'pending',
      detail: `${scoredCount}/${RECOVERY_KEYS.length} scored`,
    },
    {
      id: 'safety',
      label: CHECKIN_STEP_LABELS.safety,
      status: safetyAnsweredCount === SAFETY_FLAGS.length ? 'done' : 'pending',
      detail:
        safetyAnsweredCount === SAFETY_FLAGS.length
          ? 'Complete'
          : `${safetyAnsweredCount}/${SAFETY_FLAGS.length} answered`,
    },
    {
      id: 'availability',
      label: CHECKIN_STEP_LABELS.availability,
      status: timeAvailable === null ? 'pending' : 'done',
      detail: timeAvailable === null ? 'Not set' : `${timeAvailable} min`,
    },
  ];
}
