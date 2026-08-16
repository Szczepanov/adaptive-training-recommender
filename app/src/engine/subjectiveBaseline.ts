import type { DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

/**
 * Phase 9.1: computes a per-athlete subjective baseline -- recent (default 7d) vs a
 * longer reference window (default 28d) location and variability per subjective
 * dimension -- from prior check-in history. Pure and synchronous (D-SUBJPURE): callers
 * supply already-fetched, already-validated check-ins; this module performs no I/O and
 * reads nothing itself. `evaluateReadinessAndSafetyEnvelope` (9.2/9.3) receives the
 * result as data, the same way it already receives `derived.hrv7dAvg` and friends.
 *
 * D-SUBJHIST is load-bearing: `asOfDate` is EXCLUSIVE. A decision made for date `D` may
 * only look at check-ins whose local date is strictly before `D` -- today's own submitted
 * check-in never contributes to the baseline used to interpret today, which would
 * otherwise partially double-count the same observation against itself.
 */

export const SUBJECTIVE_BASELINE_METRICS = [
    'readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation',
] as const;
export type SubjectiveBaselineMetric = typeof SUBJECTIVE_BASELINE_METRICS[number];

export interface SubjectiveBaselinePolicy {
    /** Identifies which policy produced a `SubjectiveBaseline`, so a persisted audit or a
     *  later 9.6 sensitivity run can trace a decision back to the exact reference values
     *  used to compute it, without carrying the whole policy object on every audit. */
    estimatorId: string;
    recentWindowDays: number;
    longWindowDays: number;
    minRecentRecordedDays: number;
    minLongRecordedDays: number;
    /** Floors a metric's computed variability so a flat trailing history (or history that
     *  happens to land on very few distinct values) cannot produce a division-by-near-zero
     *  scale downstream in 9.3's z-style comparison. */
    variabilityFloor: number;
    /** Per-metric contribution cap 9.3's drift term applies when it aggregates this
     *  baseline into a score. Carried on the policy, not applied here -- 9.1 only computes
     *  the baseline; capping a comparison is 9.3's concern once 9.3 exists. */
    contributionCap: number;
}

/**
 * The first reference candidate (plan 9.1) -- explicitly NOT an ADR invariant (D-SUBJEST).
 * 9.6 measures this alongside alternative window lengths, coverage floors, variability
 * floors and caps; nothing here is a physiological fact, only a concrete starting point
 * the harness needs to have something to measure.
 */
export const REFERENCE_SUBJECTIVE_BASELINE_POLICY: SubjectiveBaselinePolicy = {
    estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
    recentWindowDays: 7,
    longWindowDays: 28,
    // ~36% coverage floor on each window -- the same ratio contextBrief.ts's existing
    // SUBJECTIVE_BASELINE_MIN_DAYS (10) / SUBJECTIVE_BASELINE_DAYS (28) already uses for its
    // own 28-day subjective baseline. Duplicated rather than imported: this module sits on
    // the decision path once 9.2/9.3 land, and importing from the brief renderer would give
    // it a dependency it has no other reason to carry -- the same reasoning `externalSession.ts`
    // gives for duplicating `EXTERNAL_MODIFY_MAX_SYSTEMIC_COST` instead of importing it from
    // `rules.ts`. If the reference numbers drift apart from contextBrief.ts's, that is a
    // real finding for 9.6 to report, not a bug -- D-SUBJEST leaves both free to move.
    minRecentRecordedDays: 4,
    minLongRecordedDays: 10,
    variabilityFloor: 1.0,
    contributionCap: 2.0, // matches rules.ts's existing STRAIN_Z_CAP
};

export interface SubjectiveMetricBaseline {
    recentAvg: number;
    longAvg: number;
    /** Population stdev over the long window, floored at `policy.variabilityFloor`. */
    variability: number;
}

export interface SubjectiveBaseline {
    estimatorId: string;
    /** The exclusive boundary this baseline was computed against, restated on the output
     *  so a consumer -- or a replayed audit -- never has to re-derive it from context. */
    historyThroughDateExclusive: string;
    recentRecordedDays: number;
    longRecordedDays: number;
    lastObservationDate: string | null;
    metrics: Record<SubjectiveBaselineMetric, SubjectiveMetricBaseline>;
}

function mean(values: readonly number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function populationStdev(values: readonly number[]): number {
    const avg = mean(values);
    const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * Distinct-date, complete-check-in-only history within `[windowStart, asOfDateExclusive)`.
 * Only `dataQuality.isComplete` check-ins count -- a partial minimum-safety check-in can
 * still carry pain/illness meaning for that day (see `safetyCheckin.ts`), but its null
 * subjective dimensions do not mature a baseline, the same convention `contextBrief.ts`'s
 * subjective section already uses. Duplicate documents for the same date collapse to one
 * entry (last one in `checkins` wins) so a data anomaly cannot inflate coverage or
 * double-weight a date's value in the mean.
 */
function windowedCompleteCheckins(
    checkins: readonly DailySubjectiveCheckin[],
    windowStart: string,
    asOfDateExclusive: string,
): Map<string, DailySubjectiveCheckin> {
    const byDate = new Map<string, DailySubjectiveCheckin>();
    for (const checkin of checkins) {
        if (!checkin.dataQuality.isComplete) continue;
        if (checkin.date < windowStart || checkin.date >= asOfDateExclusive) continue;
        byDate.set(checkin.date, checkin);
    }
    return byDate;
}

export function computeSubjectiveBaseline(
    checkins: readonly DailySubjectiveCheckin[],
    asOfDate: string,
    policy: SubjectiveBaselinePolicy,
): SubjectiveBaseline | null {
    const recentStart = addDaysToLocalDateString(asOfDate, -policy.recentWindowDays);
    const longStart = addDaysToLocalDateString(asOfDate, -policy.longWindowDays);

    const recentByDate = windowedCompleteCheckins(checkins, recentStart, asOfDate);
    const longByDate = windowedCompleteCheckins(checkins, longStart, asOfDate);

    // Recent and long coverage are checked separately (D-SUBJCOV): forcing one combined
    // count would let a long-window-only history pass as if the athlete had checked in
    // recently, or vice versa.
    if (recentByDate.size < policy.minRecentRecordedDays) return null;
    if (longByDate.size < policy.minLongRecordedDays) return null;

    const metrics = {} as Record<SubjectiveBaselineMetric, SubjectiveMetricBaseline>;
    for (const metric of SUBJECTIVE_BASELINE_METRICS) {
        const recentValues = [...recentByDate.values()].map(c => c[metric]).filter((v): v is number => v !== null);
        const longValues = [...longByDate.values()].map(c => c[metric]).filter((v): v is number => v !== null);
        // Every counted day is a *complete* check-in (all six dimensions scored), so this
        // can only be empty if the coverage checks above already returned null -- guarded
        // defensively rather than assumed, since "complete" is data, not a type guarantee.
        if (recentValues.length === 0 || longValues.length === 0) return null;
        metrics[metric] = {
            recentAvg: mean(recentValues),
            longAvg: mean(longValues),
            variability: Math.max(populationStdev(longValues), policy.variabilityFloor),
        };
    }

    // Any complete check-in strictly before asOfDate, not only the ones inside the long
    // window -- an athlete who stopped checking in 40 days ago should report that as their
    // last observation, not read as indistinguishable from never having checked in at all.
    const priorComplete = checkins.filter(c => c.dataQuality.isComplete && c.date < asOfDate);
    const lastObservationDate = priorComplete.length > 0
        ? priorComplete.reduce((latest, c) => (c.date > latest ? c.date : latest), priorComplete[0].date)
        : null;

    return {
        estimatorId: policy.estimatorId,
        historyThroughDateExclusive: asOfDate,
        recentRecordedDays: recentByDate.size,
        longRecordedDays: longByDate.size,
        lastObservationDate,
        metrics,
    };
}
