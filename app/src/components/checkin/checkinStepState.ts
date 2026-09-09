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
 *
 * Persisted `dataQuality.missingFields` is authoritative when available. This matters for
 * compatibility reads where the parser can normalize an omitted legacy field (notably
 * `illnessSymptoms`) into the typed model without changing the fact that the field itself
 * was absent from the saved document.
 */
export function deriveCheckinSteps(
  savedCheckin: Partial<DailySubjectiveCheckin> | null,
  pendingFollowupCount: number,
): CheckinStepState[] {
  const persistedMissingFields = savedCheckin?.dataQuality?.missingFields;
  const hasPersistedCompleteness = Array.isArray(persistedMissingFields);
  const missing = new Set(persistedMissingFields ?? []);

  const recoveryIsSaved = (key: typeof RECOVERY_KEYS[number]) =>
    typeof savedCheckin?.[key] === 'number'
    && (!hasPersistedCompleteness || !missing.has(key));
  const safetyIsSaved = (flag: typeof SAFETY_FLAGS[number]) =>
    savedCheckin?.[flag] !== undefined
    && (!hasPersistedCompleteness || !missing.has(flag));

  const savedRecoveryCount = RECOVERY_KEYS.filter(recoveryIsSaved).length;
  const savedSafetyCount = SAFETY_FLAGS.filter(safetyIsSaved).length;
  const savedTimeAvailable = savedCheckin?.availability?.timeAvailableMin ?? null;
  const availabilityIsSaved = savedTimeAvailable !== null
    && (!hasPersistedCompleteness || !missing.has('timeAvailableMin'));

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
      status: availabilityIsSaved ? 'done' : 'pending',
      detail: availabilityIsSaved ? `${savedTimeAvailable} min saved` : 'Not saved',
    },
  ];
}
