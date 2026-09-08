import type { DimensionalFatigue, SessionTemplate, WorkoutCostProfile } from '../models';
import { decayFatigue } from '../fatigue';
import { getDayDiff } from '../../utils/localDate';
import type { ScenarioDecisionTrace } from './analyze';

/**
 * Issue #458 / docs/analysis/2026-09-07-recommender-optimization-opportunities.md §4 --
 * deterministic sequencing diagnostics, derived purely from already-produced
 * `ScenarioDecisionTrace[]`. No production behavior change: every function here is a pure
 * reduction over existing trace data and never feeds back into recommendation selection.
 */

const COLLISION_EPSILON = 1e-6;

const FATIGUE_DIMENSIONS: (keyof DimensionalFatigue)[] = [
    'systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular',
];

/** Quality-work categories for this first cut (analysis §4.3: "do not assume phase-aware
 * classification yet -- that is Priority 2's job"). Mirrors the category groupings already
 * used as anchor/quality signals in optimizer.ts (ANCHOR_HISTORY_CATEGORIES,
 * HEAVY_LOWER_BODY_STRENGTH_CATEGORIES) rather than inventing a new taxonomy. */
const QUALITY_CATEGORIES: ReadonlySet<SessionTemplate['category']> = new Set([
    'Hard Endurance', 'Race-Specific Endurance', 'Moderate Endurance',
    'Lower-body Strength', 'Full-body Strength',
]);

const RECOVERY_CATEGORIES: ReadonlySet<SessionTemplate['category']> = new Set(['Rest', 'Mobility/Recovery']);

/** A day counts as "high collision" for recovery-placement purposes above this threshold.
 * Chosen as the midpoint of the [0, 1] collision range; this is a diagnostic bucketing
 * constant, not a gate, and can be recalibrated once corpus distributions exist (see the
 * plan's Deferred section). */
const HIGH_COLLISION_THRESHOLD = 0.5;

export interface ResidualFatigueCollisionDay {
    date: string;
    weekIndex: number;
    collision: number;
    topDimensions: string[];
}

export interface AdjacentCostOverlapPair {
    date: string;
    previousDate: string;
    overlap: number;
    lowerBodyOverlap: number;
    impactTissueOverlap: number;
    neuromuscularOverlap: number;
}

export interface QualitySpacingDiagnostics {
    gapsDays: number[];
    minGapDays: number | null;
    medianGapDays: number | null;
    adjacentQualityDayCount: number;
    longestQualityStreak: number;
    qualityPer3DayWindowMax: number;
    qualityPer7DayWindowMax: number;
}

export interface WeeklyHardDayConcentration {
    weekIndex: number;
    hardDayCount: number;
    maxHardStreak: number;
    recoveryAfterHighCollisionCount: number;
    recoveryWhileFatigueLowAndWorkFeasibleCount: number;
}

export interface OpportunityCostDiagnostics {
    daysWithRankingAudit: number;
    utilityWinnerBlockedCount: number;
    meanBlockedUtilityGap: number;
    maxBlockedUtilityGap: number;
    blockedByTier: { coverage: number; recovery: number; benefit: number };
}

export interface SequencingDiagnostics {
    residualFatigueCollision: {
        perDay: ResidualFatigueCollisionDay[];
        meanCollision: number;
        maxCollision: number;
    };
    adjacentCostOverlap: {
        perPair: AdjacentCostOverlapPair[];
        maxLowerBodyOverlap: number;
        maxImpactTissueOverlap: number;
        maxNeuromuscularOverlap: number;
        meanOverlap: number;
    };
    qualitySpacing: QualitySpacingDiagnostics;
    hardDayConcentration: { weekly: WeeklyHardDayConcentration[] };
    opportunityCost: OpportunityCostDiagnostics;
}

function costMagnitude(cost: WorkoutCostProfile): number {
    return FATIGUE_DIMENSIONS.reduce((sum, dim) => sum + cost[dim], 0);
}

/** §4.1: collision_t = sum_d(F_t[d] * C_t[d]) / max(epsilon, sum_d(C_t[d])). */
function computeResidualFatigueCollision(traces: readonly ScenarioDecisionTrace[]): SequencingDiagnostics['residualFatigueCollision'] {
    const perDay: ResidualFatigueCollisionDay[] = traces.map(trace => {
        const cost = trace.selected.projectedCost;
        const fatigue = trace.fatigue.combined;
        const totalCost = costMagnitude(cost);
        const weighted = FATIGUE_DIMENSIONS.reduce((sum, dim) => sum + fatigue[dim] * cost[dim], 0);
        const collision = totalCost <= COLLISION_EPSILON ? 0 : weighted / Math.max(COLLISION_EPSILON, totalCost);

        const topDimensions = totalCost <= COLLISION_EPSILON
            ? []
            : [...FATIGUE_DIMENSIONS]
                .map(dim => ({ dim, contribution: fatigue[dim] * cost[dim] }))
                .filter(entry => entry.contribution > 0)
                .sort((a, b) => b.contribution - a.contribution)
                .slice(0, 2)
                .map(entry => entry.dim);

        return { date: trace.date, weekIndex: trace.weekIndex, collision, topDimensions };
    });

    const collisions = perDay.map(d => d.collision);
    return {
        perDay,
        meanCollision: mean(collisions),
        maxCollision: collisions.length > 0 ? Math.max(...collisions) : 0,
    };
}

/** §4.2: compares each day's selected cost vector against the previous non-recovery
 * session's cost vector, decayed to the current date using the same per-dimension half-lives
 * fatigue.ts already uses for live decay (no new decay constants invented here). */
function computeAdjacentCostOverlap(traces: readonly ScenarioDecisionTrace[]): SequencingDiagnostics['adjacentCostOverlap'] {
    const perPair: AdjacentCostOverlapPair[] = [];
    let previous: ScenarioDecisionTrace | null = null;

    for (const trace of traces) {
        const isRecoveryDay = RECOVERY_CATEGORIES.has(trace.selected.category);
        if (previous && !isRecoveryDay && !RECOVERY_CATEGORIES.has(previous.selected.category)) {
            const elapsedHours = Math.max(0, getDayDiff(trace.date, previous.date)) * 24;
            const decayedPrevious = decayFatigue(previous.selected.projectedCost, elapsedHours);
            const currentCost = trace.selected.projectedCost;
            const overlap = FATIGUE_DIMENSIONS.reduce((sum, dim) => sum + Math.min(decayedPrevious[dim], currentCost[dim]), 0);

            perPair.push({
                date: trace.date,
                previousDate: previous.date,
                overlap,
                lowerBodyOverlap: Math.min(decayedPrevious.lowerBody, currentCost.lowerBody),
                impactTissueOverlap: Math.min(decayedPrevious.impactTissue, currentCost.impactTissue),
                neuromuscularOverlap: Math.min(decayedPrevious.neuromuscular, currentCost.neuromuscular),
            });
        }
        previous = trace;
    }

    return {
        perPair,
        maxLowerBodyOverlap: maxOf(perPair, p => p.lowerBodyOverlap),
        maxImpactTissueOverlap: maxOf(perPair, p => p.impactTissueOverlap),
        maxNeuromuscularOverlap: maxOf(perPair, p => p.neuromuscularOverlap),
        meanOverlap: mean(perPair.map(p => p.overlap)),
    };
}

/** §4.3: calendar-day gaps between quality sessions, plus rolling-window density. Does not
 * assume any gap length is "wrong" -- see the module doc comment. */
function computeQualitySpacing(traces: readonly ScenarioDecisionTrace[]): QualitySpacingDiagnostics {
    const qualityDates = traces.filter(t => QUALITY_CATEGORIES.has(t.selected.category)).map(t => t.date);
    const gapsDays = qualityDates.slice(1).map((date, i) => getDayDiff(date, qualityDates[i]));

    let longestQualityStreak = 0;
    let currentStreak = 0;
    let adjacentQualityDayCount = 0;
    for (const gap of gapsDays) {
        if (gap === 1) {
            currentStreak = currentStreak === 0 ? 2 : currentStreak + 1;
            adjacentQualityDayCount += 1;
        } else {
            currentStreak = 0;
        }
        longestQualityStreak = Math.max(longestQualityStreak, currentStreak);
    }
    if (qualityDates.length === 1) longestQualityStreak = Math.max(longestQualityStreak, 1);

    const windowCount = (windowDays: number): number => {
        let max = 0;
        for (const trace of traces) {
            const windowStart = trace.date;
            const count = qualityDates.filter(d => {
                const diff = getDayDiff(d, windowStart);
                return diff >= 0 && diff < windowDays;
            }).length;
            max = Math.max(max, count);
        }
        return max;
    };

    return {
        gapsDays,
        minGapDays: gapsDays.length > 0 ? Math.min(...gapsDays) : null,
        medianGapDays: median(gapsDays),
        adjacentQualityDayCount,
        longestQualityStreak,
        qualityPer3DayWindowMax: windowCount(3),
        qualityPer7DayWindowMax: windowCount(7),
    };
}

/** §4.4: per-week hard-day count/streak plus a rough split between "unsafe density" and
 * "unnecessarily conservative recovery" using the residual-fatigue collision score already
 * computed above and each day's activeObjectives feasibility. */
function computeHardDayConcentration(
    traces: readonly ScenarioDecisionTrace[],
    collisionByDate: Map<string, number>,
): WeeklyHardDayConcentration[] {
    const byWeek = new Map<number, ScenarioDecisionTrace[]>();
    traces.forEach(trace => {
        const list = byWeek.get(trace.weekIndex) ?? [];
        list.push(trace);
        byWeek.set(trace.weekIndex, list);
    });

    return [...byWeek.entries()].sort(([a], [b]) => a - b).map(([weekIndex, weekTraces]) => {
        let hardDayCount = 0;
        let maxHardStreak = 0;
        let currentHardStreak = 0;
        let recoveryAfterHighCollisionCount = 0;
        let recoveryWhileFatigueLowAndWorkFeasibleCount = 0;

        weekTraces.forEach((trace, i) => {
            const isHard = QUALITY_CATEGORIES.has(trace.selected.category);
            const isRecovery = RECOVERY_CATEGORIES.has(trace.selected.category);
            if (isHard) {
                hardDayCount += 1;
                currentHardStreak += 1;
                maxHardStreak = Math.max(maxHardStreak, currentHardStreak);
            } else {
                currentHardStreak = 0;
            }

            if (isRecovery) {
                const previous = i > 0 ? weekTraces[i - 1] : undefined;
                if (previous && (collisionByDate.get(previous.date) ?? 0) >= HIGH_COLLISION_THRESHOLD) {
                    recoveryAfterHighCollisionCount += 1;
                }

                const lowFatigue = FATIGUE_DIMENSIONS.every(dim => trace.fatigue.combined[dim] < HIGH_COLLISION_THRESHOLD);
                const feasibleWorkRemains = trace.activeObjectives.some(o => o.projectedCredit < o.requiredCredit);
                if (lowFatigue && feasibleWorkRemains) recoveryWhileFatigueLowAndWorkFeasibleCount += 1;
            }
        });

        return { weekIndex, hardDayCount, maxHardStreak, recoveryAfterHighCollisionCount, recoveryWhileFatigueLowAndWorkFeasibleCount };
    });
}

/** §4.5: pure aggregation over the rankingAudit already attached to each trace -- no new
 * ranking computation here. */
function computeOpportunityCost(traces: readonly ScenarioDecisionTrace[]): OpportunityCostDiagnostics {
    const audits = traces.map(t => t.rankingAudit).filter((a): a is NonNullable<typeof a> => a !== null && a !== undefined);
    const blocked = audits.filter(a => a.bestUtilityTemplateId !== a.selectedTemplateId);
    const gaps = blocked.map(a => a.selectedVsBestUtilityGap ?? 0);

    return {
        daysWithRankingAudit: audits.length,
        utilityWinnerBlockedCount: blocked.length,
        meanBlockedUtilityGap: mean(gaps),
        maxBlockedUtilityGap: gaps.length > 0 ? Math.max(...gaps) : 0,
        blockedByTier: {
            coverage: blocked.filter(a => a.utilityWinnerBlockedByCoverageTier).length,
            recovery: blocked.filter(a => a.utilityWinnerBlockedByRecoveryTier).length,
            benefit: blocked.filter(a => a.utilityWinnerBlockedByBenefitTier).length,
        },
    };
}

export function computeSequencingDiagnostics(traces: readonly ScenarioDecisionTrace[]): SequencingDiagnostics {
    const residualFatigueCollision = computeResidualFatigueCollision(traces);
    const collisionByDate = new Map(residualFatigueCollision.perDay.map(d => [d.date, d.collision]));

    return {
        residualFatigueCollision,
        adjacentCostOverlap: computeAdjacentCostOverlap(traces),
        qualitySpacing: computeQualitySpacing(traces),
        hardDayConcentration: { weekly: computeHardDayConcentration(traces, collisionByDate) },
        opportunityCost: computeOpportunityCost(traces),
    };
}

function mean(values: readonly number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function maxOf<T>(items: readonly T[], select: (item: T) => number): number {
    return items.length > 0 ? Math.max(...items.map(select)) : 0;
}
