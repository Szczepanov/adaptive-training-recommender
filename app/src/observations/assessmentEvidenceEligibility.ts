import type { AssessmentAttempt } from './models';

/**
 * Benchmark-evidence eligibility for assessment attempts (Issue #897 WP8, ADR-0046).
 *
 * Practice/familiarization evidence never silently becomes a benchmark, and an abandoned
 * (or otherwise non-completed) attempt retains its evidence but is never promoted to
 * benchmark status. The History read model (`assessmentProgress.ts`
 * `computeSeriesProgress`), goal current-value resolution (`goalProgress.ts`) and the
 * block outcome report boundary (`blockOutcomeReportService.ts`) all share this one rule.
 *
 * Pure: no Firestore, no clock.
 */
export function isBenchmarkEligibleAttempt(attempt: AssessmentAttempt): boolean {
    return attempt.state === 'completed' && attempt.purpose !== 'familiarization';
}

/**
 * Ids of the attempts whose observations may serve as benchmark evidence. Callers must
 * fail closed: an observation whose attempt is absent from this set is not eligible.
 */
export function benchmarkEligibleAttemptIds(attempts: readonly AssessmentAttempt[]): ReadonlySet<string> {
    return new Set(attempts.filter(isBenchmarkEligibleAttempt).map(attempt => attempt.id));
}
