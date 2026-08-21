import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';

/**
 * App-shell persistence and the panel's independent Firestore read can complete in either
 * order. Select only revisions for the active user/date and prefer the newest immutable
 * revision, so a just-persisted shadow result can replace an earlier "missing" read without
 * ever becoming recommendation input.
 */
export function selectHealthAnomalyShadowRevision(
  userId: string,
  date: string,
  ...candidates: Array<HealthAnomalyAssessmentRevision | null | undefined>
): HealthAnomalyAssessmentRevision | null {
  const matching = candidates.filter((candidate): candidate is HealthAnomalyAssessmentRevision =>
    candidate?.userId === userId && candidate.date === date,
  );
  matching.sort((left, right) => right.computedAt.localeCompare(left.computedAt)
    || right.revisionId.localeCompare(left.revisionId));
  return matching[0] ?? null;
}
