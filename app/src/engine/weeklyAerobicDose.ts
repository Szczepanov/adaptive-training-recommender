import { addDaysToLocalDateString } from '../utils/localDate';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingPriority } from './models';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';

export const WEEKLY_AEROBIC_EVIDENCE_WINDOW_DAYS = 28;
export const WEEKLY_AEROBIC_MIN_OBSERVED_WEEKS = 3;
export const WEEKLY_AEROBIC_HEALTH_FLOOR_MIN = 150;
export const WEEKLY_AEROBIC_HEALTH_TARGET_MAX_MIN = 300;

export interface WeeklyAerobicDoseEnvelope {
    source: 'guideline_fallback' | 'athlete_history';
    modality: 'Cycling' | 'Running' | 'Walking' | 'Swimming' | null;
    floorMinutes: number;
    targetMinutes: number;
    upperMinutes: number;
    typicalSessionMinutes: number | null;
    longAnchor: { workoutId: string; durationMinutes: number } | null;
    weeklyMinutes: readonly number[];
    observedWeeks: number;
}

export interface WeeklyAerobicDoseInput {
    exposures: readonly CompletedExposure[];
    asOfDate: string;
    observedWindowDays: number;
    priorities: readonly TrainingPriority[];
    phaseName?: string;
    trainingAgeEstablished: boolean;
}

const AEROBIC_MODALITIES = ['Cycling', 'Running', 'Walking', 'Swimming'] as const;

function isLowIntensityAerobic(exposure: CompletedExposure): boolean {
    if (!exposure.modality || !AEROBIC_MODALITIES.includes(exposure.modality as typeof AEROBIC_MODALITIES[number])) return false;
    // Count minutes only where the completed-session record identifies continuous easy
    // endurance. Quality is still credited by the canonical stimulus ledger, but is not
    // converted into low-intensity support minutes.
    return exposure.category === 'Easy Endurance'
        || exposure.trainingRecordLike.type.toLowerCase().includes('zone 2');
}

function duration(exposure: CompletedExposure): number | null {
    const minutes = exposure.trainingRecordLike.duration_min;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function median(sorted: readonly number[]): number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function dominantModality(exposures: readonly CompletedExposure[]): WeeklyAerobicDoseEnvelope['modality'] {
    const minutes = new Map<string, number>();
    for (const exposure of exposures) {
        if (!exposure.modality || !AEROBIC_MODALITIES.includes(exposure.modality as typeof AEROBIC_MODALITIES[number])) continue;
        const value = duration(exposure);
        if (value !== null && isLowIntensityAerobic(exposure)) {
            minutes.set(exposure.modality, (minutes.get(exposure.modality) ?? 0) + value);
        }
    }
    return [...minutes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] as WeeklyAerobicDoseEnvelope['modality'] ?? null;
}

const LONG_AEROBIC_ROLE_BY_MODALITY = {
    Cycling: { workoutId: 'cycling_zone2_standard_01', templateId: 'end_easy_01' },
    Running: { workoutId: 'running_easy_continuous_01', templateId: 'end_easy_02' },
    Walking: { workoutId: 'walking_brisk_continuous_01', templateId: 'end_walk_01' },
    Swimming: { workoutId: 'swimming_easy_aerobic_01', templateId: 'swim_easy_01' },
} as const;

export function executableLongAerobicCeilingForWorkout(workoutId: string): number | undefined {
    const role = Object.values(LONG_AEROBIC_ROLE_BY_MODALITY).find(candidate => candidate.workoutId === workoutId);
    return role ? ENRICHED_TEMPLATES_BY_ID.get(role.templateId)?.durationMax : undefined;
}

/**
 * Resolve a low-intensity weekly dose from four fixed, completed seven-day bins.
 * Availability and readiness are intentionally absent: neither can increase an
 * athlete's established target. Sparse or non-established evidence keeps the public
 * health guideline fallback. This resolver is pure and receives its bounded evidence.
 */
export function resolveWeeklyAerobicDoseEnvelope(input: WeeklyAerobicDoseInput): WeeklyAerobicDoseEnvelope {
    const start = addDaysToLocalDateString(input.asOfDate, -WEEKLY_AEROBIC_EVIDENCE_WINDOW_DAYS);
    const evidence = input.exposures.filter(exposure => exposure.date >= start
        && exposure.date < input.asOfDate && isLowIntensityAerobic(exposure));
    const sumWeeks = (weeklyEvidence: readonly CompletedExposure[]) => Array.from({ length: 4 }, (_, week) => {
        const weekStart = addDaysToLocalDateString(start, week * 7);
        const weekEnd = addDaysToLocalDateString(weekStart, 7);
        return weeklyEvidence
            .filter(exposure => exposure.date >= weekStart && exposure.date < weekEnd)
            .reduce((total, exposure) => total + (duration(exposure) ?? 0), 0);
    });
    const allModalityWeeklyMinutes = sumWeeks(evidence);
    const allObservedWeeks = allModalityWeeklyMinutes.filter(value => value > 0).length;
    const modality = dominantModality(evidence);
    const modalityEvidence = evidence.filter(exposure => exposure.modality === modality);
    const weeklyMinutes = sumWeeks(modalityEvidence);
    const observedWeeks = weeklyMinutes.filter(value => value > 0).length;
    const adequateHistory = input.observedWindowDays >= WEEKLY_AEROBIC_EVIDENCE_WINDOW_DAYS
        && input.trainingAgeEstablished
        && observedWeeks >= WEEKLY_AEROBIC_MIN_OBSERVED_WEEKS;
    if (!adequateHistory) {
        return {
            source: 'guideline_fallback', modality: null,
            floorMinutes: WEEKLY_AEROBIC_HEALTH_FLOOR_MIN,
            targetMinutes: WEEKLY_AEROBIC_HEALTH_FLOOR_MIN,
            upperMinutes: WEEKLY_AEROBIC_HEALTH_TARGET_MAX_MIN,
            typicalSessionMinutes: null,
            longAnchor: null,
            weeklyMinutes: allModalityWeeklyMinutes, observedWeeks: allObservedWeeks,
        };
    }

    const sorted = [...weeklyMinutes].sort((a, b) => a - b);
    const maintenance = median(sorted);
    const enduranceIntent = input.priorities.includes('endurance')
        || input.priorities.includes('sport_readiness');
    const developmentPhase = input.phaseName === 'Build' || input.phaseName === 'Specificity';
    const target = enduranceIntent && developmentPhase ? percentile(sorted, 0.75) : maintenance;
    const floor = Math.max(WEEKLY_AEROBIC_HEALTH_FLOOR_MIN, percentile(sorted, 0.25));
    const boundedTarget = Math.max(floor, target);

    // Complete history is not, by itself, evidence for a primary-modality easy-aerobic
    // obligation above the public-health minimum. When the selected history statistic
    // does not raise the weekly target above 150 minutes, keep guideline semantics:
    // moderate/vigorous work may contribute through the existing equivalence rule and no
    // athlete-specific long anchor is manufactured from sub-guideline easy volume.
    if (boundedTarget <= WEEKLY_AEROBIC_HEALTH_FLOOR_MIN) {
        return {
            source: 'guideline_fallback', modality: null,
            floorMinutes: WEEKLY_AEROBIC_HEALTH_FLOOR_MIN,
            targetMinutes: WEEKLY_AEROBIC_HEALTH_FLOOR_MIN,
            upperMinutes: WEEKLY_AEROBIC_HEALTH_TARGET_MAX_MIN,
            typicalSessionMinutes: null,
            longAnchor: null,
            weeklyMinutes: allModalityWeeklyMinutes, observedWeeks: allObservedWeeks,
        };
    }

    const upper = Math.max(percentile(sorted, 0.75), boundedTarget);
    const modalitySessions = modalityEvidence
        .map(duration)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
    const anchorRole = modality ? LONG_AEROBIC_ROLE_BY_MODALITY[modality] : undefined;
    const anchorWorkoutId = anchorRole?.workoutId;
    // The long-anchor requirement is consumed by the engine-template allocator, whose
    // standard prescription is what it can materialize without a separate progression
    // decision. Cap here at that executable ceiling rather than the detailed workout's
    // harder-dose maximum; otherwise packing can claim a 90-minute role that allocation
    // cannot actually prescribe.
    const anchorMaximum = anchorWorkoutId ? executableLongAerobicCeilingForWorkout(anchorWorkoutId) : undefined;
    const typicalSessionMinutes = anchorMaximum && modalitySessions.length > 0
        ? Math.min(anchorMaximum, median(modalitySessions))
        : null;
    const anchorHistoryDuration = percentile(modalitySessions, 0.75);
    const longAnchor = anchorWorkoutId && anchorMaximum && modalitySessions.length >= 4
        ? { workoutId: anchorWorkoutId, durationMinutes: Math.min(anchorMaximum, Math.max(30, anchorHistoryDuration)) }
        : null;
    return {
        source: 'athlete_history', modality,
        floorMinutes: floor, targetMinutes: boundedTarget,
        upperMinutes: upper, typicalSessionMinutes, longAnchor, weeklyMinutes, observedWeeks,
    };
}
