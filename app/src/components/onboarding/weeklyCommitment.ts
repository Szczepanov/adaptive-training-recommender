export type WeeklyCommitment = {
  minSessions: number;
  targetSessions: number;
  maxSessions: number;
};

/**
 * The onboarding question is deliberately expressed as available exercise *days*, while
 * the persisted training-intent contract is session-based. Treat one session per available
 * day as the target and retain the existing ±1 planning flexibility. The +1 maximum may
 * represent one double-session day; it does not invent an additional available day.
 */
export function weeklyCommitmentFromExerciseDays(exerciseDaysPerWeek: number): WeeklyCommitment {
  const days = Math.min(7, Math.max(1, Math.round(exerciseDaysPerWeek)));
  return {
    minSessions: Math.max(1, days - 1),
    targetSessions: days,
    maxSessions: Math.min(14, days + 1),
  };
}
