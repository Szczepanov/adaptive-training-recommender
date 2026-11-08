import type { HealthAnomalyAssessmentRevision } from '../derived/flags/illnessAnomaly/healthAnomalyModels';

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

export type HealthAnomalyLoadStatus = 'ready' | 'missing' | 'error';

export interface HealthAnomalyLoadResult {
  userId: string;
  date: string;
  status: HealthAnomalyLoadStatus;
  /** #1202: stored revisions for the date that could not be read. */
  unreadableCount?: number;
}

/**
 * The persisted-assessment read is keyed to a user/date. When either changes while a
 * request is in flight, a stale result -- including a stale error -- must not be shown
 * as describing the new target. Resolve to 'loading' until a result matching the active
 * user/date arrives, rather than reusing whatever the previous target last resolved to.
 */
export function selectHealthAnomalyLoadState(
  userId: string,
  date: string,
  result: HealthAnomalyLoadResult | null,
): 'loading' | HealthAnomalyLoadStatus {
  return result && result.userId === userId && result.date === date ? result.status : 'loading';
}

/**
 * #1202: how many stored revisions for the active user/date could not be read while a revision
 * is shown. Any unreadable revision could be newer than the shown one, including this session's
 * live revision (another device or a newer client may have written it), so a non-zero result
 * means the panel says so and withholds follow-up outcomes. Zero when everything was readable,
 * nothing is shown, or the result belongs to another target.
 */
export function selectHealthAnomalyUncertainLatestCount(
  userId: string,
  date: string,
  result: HealthAnomalyLoadResult | null,
  shown: HealthAnomalyAssessmentRevision | null,
): number {
  if (!result || result.userId !== userId || result.date !== date) return 0;
  const count = result.unreadableCount ?? 0;
  return count > 0 && shown !== null ? count : 0;
}

/**
 * #1202: the load status for a diagnostics read. Nothing readable but something stored is an
 * error, not "missing": a tampered record must not read as "no assessment yet".
 */
export function healthAnomalyLoadStatusFor(
  revision: HealthAnomalyAssessmentRevision | null,
  unreadableCount: number,
): HealthAnomalyLoadStatus {
  return revision ? 'ready' : unreadableCount > 0 ? 'error' : 'missing';
}
