import { getMetricDefinition } from '../observations/registry';
import type { GoalPerformanceTarget, PerformanceGoalFamily } from './performanceTargetPolicy';
import { getPerformanceTargetPolicy } from './performanceTargetPolicy';
import { computeRequiredChange } from './goalMetricMath';
import type { GoalProgressResult } from './goalProgress';
import { getLocalDateString } from '../utils/localDate';

/**
 * PG4.5/ADR-0041: goal feasibility is derived advisory state, never athlete-authored
 * UserGoal truth and never prescription authority. It is recomputed from current inputs
 * on every read rather than persisted as recommendation input. See ADR-0041 items 13-16
 * and this plan section for the full contract:
 * docs/plans/strength-speed-power-performance-goals.md#pg45--goal-feasibility-and-realism-advisory
 */
export const GOAL_FEASIBILITY_POLICY_VERSION = 'goal-feasibility-v1' as const;

export type GoalPlausibility = 'already_achieved' | 'plausible' | 'stretch' | 'unlikely' | 'insufficient_evidence';
export type FeasibilityConfidenceLevel = 'low' | 'moderate' | 'high';

export interface GoalFeasibilityCapacityInput {
    weeklyMinSessions?: number | null;
    weeklyTargetSessions?: number | null;
    weeklyMaxSessions?: number | null;
}

export interface GoalFeasibilityFactor {
    code: string;
    effect: 'supports' | 'limits' | 'uncertain';
    summary: string;
    source: 'athlete_data' | 'schedule' | 'training_history' | 'population_evidence';
}

export interface GoalFeasibilityAssessment {
    assessedAt: string;
    assessmentVersion: string;
    plausibility: GoalPlausibility;
    confidence: { level: FeasibilityConfidenceLevel; reasons: string[] };
    horizon: { targetDate: string | null; daysRemaining: number | null; weeksRemaining: number | null };
    requiredChange: {
        currentValue: number | null;
        targetValue: number;
        absolute: number | null;
        relativePct: number | null;
        /** Explanation only. Never interpreted as a prescribed weekly progression (PG4.5.3). */
        linearizedEquivalentPerWeek: number | null;
    };
    capacity: {
        weeklyMinSessions: number | null;
        weeklyTargetSessions: number | null;
        weeklyMaxSessions: number | null;
        projectedSpecificExposuresPerWeek: null;
        maxRelevantExposuresBeforeTarget: number | null;
    };
    factors: GoalFeasibilityFactor[];
    evidenceRefs: string[];
}

function daysBetween(fromDate: string, toDate: string): number {
    const from = new Date(`${fromDate}T00:00:00Z`).getTime();
    const to = new Date(`${toDate}T00:00:00Z`).getTime();
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Strength first-slice evidence policy (registered as
 * `goalFeasibility.strength.requiredChangeBands` in the Sports Knowledge Registry --
 * see knowledge/goalFeasibilityKnowledge.ts). Thresholds are a required-relative-change
 * per week, adjusted for available weekly frequency, and are deliberately conservative
 * (looser than the ~4.7-7.7%/6wk trained-men result they are anchored to) so this errs
 * toward "plausible"/"stretch" rather than false-alarming on ordinary goals.
 */
const STRENGTH_PLAUSIBLE_PCT_PER_WEEK_AT_ADEQUATE_FREQUENCY = 2.0;
const STRENGTH_STRETCH_PCT_PER_WEEK_AT_ADEQUATE_FREQUENCY = 3.5;
const STRENGTH_ADEQUATE_WEEKLY_FREQUENCY = 2;

function strengthPlausibility(requiredPctPerWeek: number, weeklyMaxSessions: number | null): GoalPlausibility {
    const frequencyFactor = weeklyMaxSessions === null
        ? 1
        : Math.min(1, weeklyMaxSessions / STRENGTH_ADEQUATE_WEEKLY_FREQUENCY);
    // A lower available frequency tightens (not loosens) the bar for "plausible", per the
    // registered evidence that higher frequency is associated with larger strength gains.
    const plausibleCeiling = STRENGTH_PLAUSIBLE_PCT_PER_WEEK_AT_ADEQUATE_FREQUENCY * Math.max(frequencyFactor, 0.2);
    const stretchCeiling = STRENGTH_STRETCH_PCT_PER_WEEK_AT_ADEQUATE_FREQUENCY * Math.max(frequencyFactor, 0.2);
    if (requiredPctPerWeek <= plausibleCeiling) return 'plausible';
    if (requiredPctPerWeek <= stretchCeiling) return 'stretch';
    return 'unlikely';
}

function familyPlausibility(
    family: PerformanceGoalFamily,
    requiredPctPerWeek: number | null,
    weeklyMaxSessions: number | null,
): { plausibility: GoalPlausibility; evidenceRefs: string[] } {
    if (requiredPctPerWeek === null) return { plausibility: 'insufficient_evidence', evidenceRefs: [] };
    if (family === 'strength') {
        return {
            plausibility: strengthPlausibility(requiredPctPerWeek, weeklyMaxSessions),
            evidenceRefs: ['goalFeasibility.strength.requiredChangeBands'],
        };
    }
    // Speed/power: the source analysis found reliable measurement-method evidence but no
    // reviewed rate-of-change band for either family. Fabricating one here would violate
    // PG4.5.5 ("no universal % improvement per week formula shared across families").
    return { plausibility: 'insufficient_evidence', evidenceRefs: [] };
}

export function assessGoalFeasibility(
    target: GoalPerformanceTarget,
    progress: GoalProgressResult,
    options: {
        targetDate?: string | null;
        capacity?: GoalFeasibilityCapacityInput;
        today?: string;
    } = {},
): GoalFeasibilityAssessment {
    const metric = getMetricDefinition(target.metricId);
    const family = getPerformanceTargetPolicy(target.metricId)?.family ?? null;
    const today = options.today ?? getLocalDateString();
    const targetDate = options.targetDate ?? null;
    const capacity = options.capacity ?? {};
    const factors: GoalFeasibilityFactor[] = [];
    const reasons: string[] = [];

    const daysRemaining = targetDate ? daysBetween(today, targetDate) : null;
    const weeksRemaining = daysRemaining !== null ? daysRemaining / 7 : null;

    const weeklyMaxSessions = capacity.weeklyMaxSessions ?? null;
    const maxRelevantExposuresBeforeTarget = weeklyMaxSessions !== null && weeksRemaining !== null && weeksRemaining > 0
        ? Math.max(0, Math.floor(weeklyMaxSessions * weeksRemaining))
        : null;

    const baseAssessment = {
        assessedAt: new Date().toISOString(),
        assessmentVersion: GOAL_FEASIBILITY_POLICY_VERSION,
        horizon: { targetDate, daysRemaining, weeksRemaining },
        requiredChange: {
            currentValue: progress.currentValue,
            targetValue: target.targetValue,
            absolute: null as number | null,
            relativePct: null as number | null,
            linearizedEquivalentPerWeek: null as number | null,
        },
        capacity: {
            weeklyMinSessions: capacity.weeklyMinSessions ?? null,
            weeklyTargetSessions: capacity.weeklyTargetSessions ?? null,
            weeklyMaxSessions,
            projectedSpecificExposuresPerWeek: null,
            maxRelevantExposuresBeforeTarget,
        },
    };

    if (!progress.hasComparableEvidence || progress.currentValue === null) {
        factors.push({ code: 'no_comparable_baseline', effect: 'limits', summary: 'No comparable current-evidence baseline is available for this target.', source: 'athlete_data' });
        return {
            ...baseAssessment,
            plausibility: 'insufficient_evidence',
            confidence: { level: 'low', reasons: ['no_comparable_baseline'] },
            factors,
            evidenceRefs: [],
        };
    }

    factors.push(
        progress.currentEvidenceKind === 'measured_observation'
            ? { code: 'baseline_is_measured_observation', effect: 'supports', summary: 'Baseline is a protocol-locked measured observation rather than an estimate.', source: 'athlete_data' }
            : { code: 'baseline_is_estimated', effect: progress.currentSource === 'coach' || progress.currentSource === 'garmin' ? 'supports' : 'uncertain', summary: `Baseline is an estimated 1RM${progress.currentSource ? ` (${progress.currentSource} source)` : ' with no recorded source'}.`, source: 'athlete_data' },
    );

    const required = computeRequiredChange(metric.direction, target.targetValue, progress.currentValue);
    if (!required) {
        return {
            ...baseAssessment,
            plausibility: 'insufficient_evidence',
            confidence: { level: 'low', reasons: ['metric_not_direction_scored'] },
            factors,
            evidenceRefs: [],
        };
    }

    const requiredChange = {
        currentValue: progress.currentValue,
        targetValue: target.targetValue,
        absolute: required.absolute,
        relativePct: required.relativePct,
        linearizedEquivalentPerWeek: weeksRemaining !== null && weeksRemaining > 0 ? required.absolute / weeksRemaining : null,
    };

    if (required.alreadyAchieved) {
        return {
            ...baseAssessment,
            requiredChange,
            plausibility: 'already_achieved',
            confidence: { level: 'high', reasons: ['current_result_already_meets_or_beats_target'] },
            factors,
            evidenceRefs: [],
        };
    }

    if (targetDate === null) {
        factors.push({ code: 'no_target_date', effect: 'limits', summary: 'No target date, so there is no horizon evidence to assess pace against.', source: 'athlete_data' });
        return {
            ...baseAssessment,
            requiredChange,
            plausibility: 'insufficient_evidence',
            confidence: { level: 'low', reasons: ['no_target_date'] },
            factors,
            evidenceRefs: [],
        };
    }

    if (weeksRemaining !== null && weeksRemaining <= 0) {
        factors.push({ code: 'target_date_has_passed', effect: 'limits', summary: 'The target date has already passed.', source: 'schedule' });
        return {
            ...baseAssessment,
            requiredChange,
            plausibility: 'unlikely',
            confidence: { level: 'high', reasons: ['target_date_has_passed'] },
            factors,
            evidenceRefs: [],
        };
    }

    if (weeklyMaxSessions === null) {
        factors.push({ code: 'capacity_unknown', effect: 'uncertain', summary: 'Weekly training capacity is not known, so relevant exposure before the target date cannot be bounded.', source: 'schedule' });
    } else {
        factors.push({ code: 'capacity_bounds_relevant_exposure', effect: 'uncertain', summary: `Total weekly capacity bounds this at no more than ${maxRelevantExposuresBeforeTarget} relevant exposures before the target date; actual target-specific frequency is not yet tracked (PG5-PG7).`, source: 'schedule' });
    }

    const requiredPctPerWeek = weeksRemaining !== null && weeksRemaining > 0 && requiredChange.relativePct !== null
        ? Math.abs(requiredChange.relativePct) / weeksRemaining
        : null;

    const { plausibility, evidenceRefs } = familyPlausibility(family ?? 'strength', requiredPctPerWeek, weeklyMaxSessions);
    if (plausibility === 'insufficient_evidence' && requiredPctPerWeek !== null) {
        factors.push({ code: 'no_reviewed_rate_evidence_for_family', effect: 'uncertain', summary: `No reviewed rate-of-change evidence band exists yet for the ${family} family.`, source: 'population_evidence' });
    } else if (requiredPctPerWeek !== null) {
        factors.push({ code: 'required_pace_vs_reviewed_band', effect: plausibility === 'unlikely' ? 'limits' : plausibility === 'plausible' ? 'supports' : 'uncertain', summary: `Required pace is approximately ${requiredPctPerWeek.toFixed(2)}%/week against a reviewed evidence band.`, source: 'population_evidence' });
    }

    const confidenceReducers: string[] = [];
    if (weeklyMaxSessions === null) confidenceReducers.push('capacity_unknown');
    if (progress.currentEvidenceKind !== 'measured_observation' && progress.currentSource !== 'coach' && progress.currentSource !== 'garmin') {
        confidenceReducers.push('baseline_may_be_stale_or_unsourced');
    }
    if (plausibility === 'insufficient_evidence') confidenceReducers.push('no_reviewed_rate_evidence_for_family');
    reasons.push(...confidenceReducers);
    if (confidenceReducers.length === 0) reasons.push('recent_or_sourced_baseline_known_capacity_reviewed_evidence_band');

    const confidenceLevel: FeasibilityConfidenceLevel = confidenceReducers.length === 0
        ? 'high'
        : confidenceReducers.length === 1
            ? 'moderate'
            : 'low';

    return {
        ...baseAssessment,
        requiredChange,
        plausibility,
        confidence: { level: plausibility === 'insufficient_evidence' ? 'low' : confidenceLevel, reasons },
        factors,
        evidenceRefs,
    };
}
