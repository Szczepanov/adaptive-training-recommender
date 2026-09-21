import type { WorkoutCostProfile } from './models';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';

/**
 * This is a catalog-load envelope, not a physiological measurement or a medical limit.
 * The evidence supports monitoring accumulated load and individualising it; the exact
 * normalized cost scale and limits remain product policy (see the knowledge registry).
 */
export const ROLLING_LOAD_BUDGET_POLICY_VERSION = '2026-09-rolling-load-budget-v2' as const;
export const ROLLING_LOAD_BUDGET_WINDOW_DAYS = 7 as const;
export const ROLLING_LOAD_BUDGET_BASELINE_DAYS = 42 as const;
export const ROLLING_LOAD_BUDGET_LOOKBACK_DAYS = ROLLING_LOAD_BUDGET_WINDOW_DAYS + ROLLING_LOAD_BUDGET_BASELINE_DAYS;
export const ROLLING_LOAD_BUDGET_MIN_BASELINE_EXPOSURES = 3 as const;
export const ROLLING_LOAD_BUDGET_MIN_BASELINE_SPAN_DAYS = 14 as const;
export const ROLLING_LOAD_BUDGET_HEADROOM_MULTIPLIER = 1.15 as const;

export type RollingLoadBudgetConfidence = 'provisional' | 'established';
export type RollingLoadBudgetSource = 'completed' | 'projected' | 'fixed' | 'overlay';

export interface RollingLoadBudgetHistoryRecord {
    date?: string;
    occurrenceKey?: string;
    templateId?: string;
    modality?: string;
    category?: string;
    systemicCost?: number;
    lowerBodyCost?: number;
    costProfile?: WorkoutCostProfile;
}

export interface RollingLoadBudgetEntry {
    date: string;
    occurrenceKey: string;
    source: RollingLoadBudgetSource;
    costProfile: WorkoutCostProfile;
}

export interface RollingLoadBudgetProfile {
    policyVersion: typeof ROLLING_LOAD_BUDGET_POLICY_VERSION;
    confidence: RollingLoadBudgetConfidence;
    baselineSessionCount: number;
    baselineWindowStartDate: string;
    baselineWindowEndDate: string;
    limits: WorkoutCostProfile;
}

export interface RollingLoadBudgetSnapshot {
    policyVersion: typeof ROLLING_LOAD_BUDGET_POLICY_VERSION;
    asOfDate: string;
    horizonStartDate: string;
    horizonEndDate: string;
    confidence: RollingLoadBudgetConfidence;
    uniqueEntryCount: number;
    consumed: WorkoutCostProfile;
    candidate: WorkoutCostProfile;
    total: WorkoutCostProfile;
    remaining: WorkoutCostProfile;
    candidateInHorizon: boolean;
    exceededDimensionsBefore: (keyof WorkoutCostProfile)[];
    exceededDimensionsAfter: (keyof WorkoutCostProfile)[];
    blockingDimensions: (keyof WorkoutCostProfile)[];
    admitted: boolean;
    reason?: 'LOAD_BUDGET_EXCEEDED';
}

export interface RollingLoadBudgetEvaluationInput {
    asOfDate: string;
    horizonStartDate: string;
    horizonEndDate: string;
    profile: RollingLoadBudgetProfile;
    entries: readonly RollingLoadBudgetEntry[];
    candidate?: RollingLoadBudgetEntry;
}

const DIMENSIONS: (keyof WorkoutCostProfile)[] = [
    'systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular',
];

/** Product floors for an established profile. Sparse-history profiles are provisional and
 * do not activate this gate; once established, personal limits cannot fall below these floors. */
export const DEFAULT_ROLLING_LOAD_BUDGET_LIMITS: WorkoutCostProfile = {
    systemic: 2.0,
    cardiovascular: 3.0,
    lowerBody: 2.0,
    upperBody: 2.0,
    impactTissue: 2.0,
    neuromuscular: 2.0,
};

const EMPTY_COST: WorkoutCostProfile = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

function finite(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function cloneCost(cost: WorkoutCostProfile): WorkoutCostProfile {
    return Object.fromEntries(DIMENSIONS.map(dimension => [dimension, finite(cost[dimension])])) as unknown as WorkoutCostProfile;
}

function addCost(left: WorkoutCostProfile, right: WorkoutCostProfile): WorkoutCostProfile {
    return Object.fromEntries(DIMENSIONS.map(dimension => [dimension, left[dimension] + right[dimension]])) as unknown as WorkoutCostProfile;
}

function subtractCost(left: WorkoutCostProfile, right: WorkoutCostProfile): WorkoutCostProfile {
    return Object.fromEntries(DIMENSIONS.map(dimension => [dimension, left[dimension] - right[dimension]])) as unknown as WorkoutCostProfile;
}

function costFromHistory(record: RollingLoadBudgetHistoryRecord): WorkoutCostProfile {
    if (record.costProfile) return cloneCost(record.costProfile);
    const systemic = finite(record.systemicCost);
    const lowerBody = finite(record.lowerBodyCost);
    // Legacy history exposes only authored systemic/lower-body fields. Preserve those
    // authorities and use a conservative, bounded projection for the missing dimensions.
    return {
        systemic,
        cardiovascular: systemic * 0.75,
        lowerBody,
        upperBody: 0,
        impactTissue: lowerBody * 0.5,
        neuromuscular: systemic * 0.5,
    };
}

function occurrenceKeyFor(record: RollingLoadBudgetHistoryRecord, index: number): string {
    return record.occurrenceKey
        ?? `${record.date ?? 'unknown'}:${record.templateId ?? record.modality ?? record.category ?? 'unknown'}:${index}`;
}

export function rollingLoadBudgetEntryFromHistory(
    record: RollingLoadBudgetHistoryRecord,
    index: number,
    source: RollingLoadBudgetSource = 'completed',
): RollingLoadBudgetEntry | null {
    if (!record.date) return null;
    return {
        date: record.date,
        occurrenceKey: occurrenceKeyFor(record, index),
        source,
        costProfile: costFromHistory(record),
    };
}

function uniqueEntries(entries: readonly RollingLoadBudgetEntry[]): RollingLoadBudgetEntry[] {
    const byOccurrence = new Map<string, RollingLoadBudgetEntry>();
    entries.forEach(entry => {
        if (!byOccurrence.has(entry.occurrenceKey)) byOccurrence.set(entry.occurrenceKey, entry);
    });
    return [...byOccurrence.values()];
}

function entriesInRange(entries: readonly RollingLoadBudgetEntry[], startDate: string, endDate: string): RollingLoadBudgetEntry[] {
    return uniqueEntries(entries.filter(entry => entry.date >= startDate && entry.date <= endDate));
}

/** The forecast envelope owns the requested future dates, beginning tomorrow. Today's
 * confirmed recommendation is already decided and remains represented by the acute-fatigue
 * chain rather than being retroactively re-gated by a forecast-only budget. */
export function resolveRollingLoadBudgetForecastHorizon(
    todayDate: string,
    futureDays: number = ROLLING_LOAD_BUDGET_WINDOW_DAYS,
): { startDate: string; endDate: string } {
    const boundedFutureDays = Math.max(1, Math.floor(futureDays));
    return {
        startDate: addDaysToLocalDateString(todayDate, 1),
        endDate: addDaysToLocalDateString(todayDate, boundedFutureDays),
    };
}

function sumCosts(entries: readonly RollingLoadBudgetEntry[]): WorkoutCostProfile {
    return entries.reduce((sum, entry) => addCost(sum, entry.costProfile), { ...EMPTY_COST });
}

function baselineEntriesFor(
    history: readonly RollingLoadBudgetHistoryRecord[],
    asOfDate: string,
): RollingLoadBudgetEntry[] {
    const currentWindowStart = addDaysToLocalDateString(asOfDate, -(ROLLING_LOAD_BUDGET_WINDOW_DAYS - 1));
    const baselineStart = addDaysToLocalDateString(currentWindowStart, -ROLLING_LOAD_BUDGET_BASELINE_DAYS);
    const baselineEnd = addDaysToLocalDateString(currentWindowStart, -1);
    return history
        .map((record, index) => rollingLoadBudgetEntryFromHistory(record, index))
        .filter((entry): entry is RollingLoadBudgetEntry => entry !== null)
        .filter(entry => entry.date >= baselineStart && entry.date <= baselineEnd);
}

export function resolveRollingLoadBudgetProfile(
    history: readonly RollingLoadBudgetHistoryRecord[],
    asOfDate: string,
): RollingLoadBudgetProfile {
    const currentWindowStart = addDaysToLocalDateString(asOfDate, -(ROLLING_LOAD_BUDGET_WINDOW_DAYS - 1));
    const baselineStart = addDaysToLocalDateString(currentWindowStart, -ROLLING_LOAD_BUDGET_BASELINE_DAYS);
    const baselineEnd = addDaysToLocalDateString(currentWindowStart, -1);
    const entries = baselineEntriesFor(history, asOfDate);
    const unique = uniqueEntries(entries);
    const dates = unique.map(entry => entry.date).sort();
    const observedSpan = dates.length > 1 ? getDayDiff(dates[dates.length - 1], dates[0]) + 1 : 0;
    const established = unique.length >= ROLLING_LOAD_BUDGET_MIN_BASELINE_EXPOSURES
        && observedSpan >= ROLLING_LOAD_BUDGET_MIN_BASELINE_SPAN_DAYS;

    if (!established) {
        return {
            policyVersion: ROLLING_LOAD_BUDGET_POLICY_VERSION,
            confidence: 'provisional',
            baselineSessionCount: 0,
            baselineWindowStartDate: baselineStart,
            baselineWindowEndDate: baselineEnd,
            limits: { ...DEFAULT_ROLLING_LOAD_BUDGET_LIMITS },
        };
    }

    const baselineTotal = sumCosts(unique);
    const weeks = Math.max(1, ROLLING_LOAD_BUDGET_BASELINE_DAYS / 7);
    const limits = Object.fromEntries(DIMENSIONS.map(dimension => [
        dimension,
        Math.max(
            DEFAULT_ROLLING_LOAD_BUDGET_LIMITS[dimension],
            (baselineTotal[dimension] / weeks) * ROLLING_LOAD_BUDGET_HEADROOM_MULTIPLIER,
        ),
    ])) as unknown as WorkoutCostProfile;

    return {
        policyVersion: ROLLING_LOAD_BUDGET_POLICY_VERSION,
        confidence: 'established',
        baselineSessionCount: unique.length,
        baselineWindowStartDate: baselineStart,
        baselineWindowEndDate: baselineEnd,
        limits,
    };
}

const EPS = 1e-9;

export function evaluateRollingLoadBudget(input: RollingLoadBudgetEvaluationInput): RollingLoadBudgetSnapshot {
    const entries = entriesInRange(input.entries, input.horizonStartDate, input.horizonEndDate);
    const candidateInHorizon = Boolean(
        input.candidate
        && input.candidate.date >= input.horizonStartDate
        && input.candidate.date <= input.horizonEndDate,
    );
    const consumed = sumCosts(entries);
    const candidateCost = candidateInHorizon && input.candidate
        ? cloneCost(input.candidate.costProfile)
        : { ...EMPTY_COST };
    const beforeRemaining = subtractCost(input.profile.limits, consumed);
    const total = addCost(consumed, candidateCost);
    const remaining = subtractCost(input.profile.limits, total);

    const exceededDimensionsBefore = DIMENSIONS.filter(d => beforeRemaining[d] < -EPS);
    const exceededDimensionsAfter = DIMENSIONS.filter(d => remaining[d] < -EPS);
    const blockingDimensions = candidateInHorizon
        ? DIMENSIONS.filter(d => candidateCost[d] > EPS && remaining[d] < -EPS)
        : [];
    // Preserve the evaluator's pre-v2 envelope-only semantics when no candidate is supplied:
    // an over-budget snapshot remains non-admitted. When a candidate is supplied, admission
    // is candidate-specific; a candidate outside the fixed horizon contributes nothing and
    // therefore is not rejected by that horizon's existing overage.
    const admitted = input.candidate
        ? blockingDimensions.length === 0
        : exceededDimensionsAfter.length === 0;

    return {
        policyVersion: input.profile.policyVersion,
        asOfDate: input.asOfDate,
        horizonStartDate: input.horizonStartDate,
        horizonEndDate: input.horizonEndDate,
        confidence: input.profile.confidence,
        uniqueEntryCount: entries.length,
        consumed,
        candidate: candidateCost,
        total,
        remaining,
        candidateInHorizon,
        exceededDimensionsBefore,
        exceededDimensionsAfter,
        blockingDimensions,
        admitted,
        ...(admitted ? {} : { reason: 'LOAD_BUDGET_EXCEEDED' as const }),
    };
}
