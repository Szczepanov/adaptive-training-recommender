import type { DailyDecisionInput, DailySubjectiveCheckin } from './models';

type SubjectiveCheckinCompletionView = {
  dataQuality?: Pick<DailySubjectiveCheckin['dataQuality'], 'isComplete'>;
};

/**
 * Canonical UI completion predicate for a persisted or in-memory subjective check-in.
 *
 * `submittedAt` is not a completion signal: draft check-ins are initialized with a timestamp
 * and partial safety/follow-up writes may persist that draft before the six subjective scores
 * are complete. The validated data-quality flag is the authority used by the decision layer.
 */
export function isCompletedSubjectiveCheckin(
  checkin: SubjectiveCheckinCompletionView | null | undefined,
): boolean {
  return checkin?.dataQuality?.isComplete === true;
}

/**
 * Decision-input equivalent of `isCompletedSubjectiveCheckin`. Requiring both flags keeps
 * the routing predicate fail-closed if an inconsistent composed payload ever reports a
 * complete check-in while also reporting that no subjective check-in exists.
 */
export function hasCompletedSubjectiveCheckinForDecision(
  input: Pick<DailyDecisionInput, 'dataQuality'>,
): boolean {
  return input.dataQuality.hasSubjectiveCheckin && input.dataQuality.subjectiveCheckinComplete;
}
