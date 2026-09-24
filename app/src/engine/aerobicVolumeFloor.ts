import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { EVERGREEN_GENERAL_COVERAGE_SET, SEPTEMBER_CYCLING_EVENT_COVERAGE_SET } from '../workouts/event-plan';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { SessionTemplate } from './models';
import type { CompletedExposure } from './trainingHistory';

/**
 * Issue #757: athlete-relative `aerobic_volume` coverage floor.
 *
 * `floor = max(catalogMinimum, round5(fraction × median))`, where `median` is the athlete's
 * median full-dose continuous aerobic session over the preceding window. With fewer than
 * the minimum number of qualifying sessions the floor stays at the catalog minimum, which
 * is today's behaviour for new users. One athlete-level floor applies to every aerobic
 * modality, so a 30-min walk cannot satisfy the role for an athlete whose typical ride is
 * 60 min. Owned by `policy.stimulus.aerobic_volume_athlete_relative_floor_v1`.
 */
export const AEROBIC_VOLUME_FLOOR_FRACTION = 0.75;
export const AEROBIC_VOLUME_FLOOR_MIN_SAMPLES = 4;
export const AEROBIC_VOLUME_FLOOR_WINDOW_DAYS = 28;
export const AEROBIC_VOLUME_FLOOR_ROUNDING_MIN = 5;
export const AEROBIC_VOLUME_FLOOR_MODALITIES: readonly SessionTemplate['modality'][] = ['Cycling', 'Running', 'Walking', 'Swimming'];

function aerobicVolumeWorkoutIds(): string[] {
    return [EVERGREEN_GENERAL_COVERAGE_SET, SEPTEMBER_CYCLING_EVENT_COVERAGE_SET]
        .flatMap(set => set.coverage.filter(item => item.key === 'aerobic_volume').flatMap(item => item.workoutIds));
}

/** Smallest catalog minimum among the authored `aerobic_volume` identities (30 min today).
 * Shorter sessions never qualify as typical-session evidence, so commutes and incidental
 * walks cannot drag the median down. */
export const AEROBIC_VOLUME_CATALOG_MINIMUM_MIN = Math.min(
    ...aerobicVolumeWorkoutIds().map(id => WORKOUTS_BY_ID.get(id)?.duration.minimumMin ?? Number.POSITIVE_INFINITY),
);

export interface AerobicVolumeFloor {
    /** Athlete-level floor before per-workout clamping. */
    floorMin: number;
    source: 'athlete_history' | 'catalog_minimum';
    sampleCount: number;
    medianMin: number | null;
}

export type AerobicFloorEvidence = Pick<CompletedExposure, 'date' | 'modality' | 'trainingRecordLike'> & {
    durationMin?: number;
    isReadinessModifiedDose?: boolean;
};

export const CATALOG_AEROBIC_VOLUME_FLOOR: AerobicVolumeFloor = {
    floorMin: AEROBIC_VOLUME_CATALOG_MINIMUM_MIN,
    source: 'catalog_minimum',
    sampleCount: 0,
    medianMin: null,
};

function evidenceDurationMin(exposure: AerobicFloorEvidence): number | undefined {
    const duration = exposure.durationMin ?? exposure.trainingRecordLike?.duration_min;
    return typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined;
}

function median(sorted: readonly number[]): number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Pure: resolve the athlete-level floor from completed evidence as of `asOfDate`
 * (exclusive, Warsaw calendar date). Callers pass read-only history; nothing is fetched. */
export function resolveAerobicVolumeFloor(
    exposures: readonly AerobicFloorEvidence[],
    asOfDate: string,
): AerobicVolumeFloor {
    const windowStart = addDaysToLocalDateString(asOfDate, -AEROBIC_VOLUME_FLOOR_WINDOW_DAYS);
    const durations = exposures
        .filter(exposure => exposure.date >= windowStart && exposure.date < asOfDate)
        .filter(exposure => !exposure.isReadinessModifiedDose)
        .filter(exposure => exposure.modality !== undefined && AEROBIC_VOLUME_FLOOR_MODALITIES.includes(exposure.modality))
        .map(evidenceDurationMin)
        .filter((duration): duration is number => duration !== undefined && duration >= AEROBIC_VOLUME_CATALOG_MINIMUM_MIN)
        .sort((left, right) => left - right);

    if (durations.length < AEROBIC_VOLUME_FLOOR_MIN_SAMPLES) {
        return { ...CATALOG_AEROBIC_VOLUME_FLOOR, sampleCount: durations.length };
    }

    const medianMin = median(durations);
    const relativeFloor = Math.round((AEROBIC_VOLUME_FLOOR_FRACTION * medianMin) / AEROBIC_VOLUME_FLOOR_ROUNDING_MIN)
        * AEROBIC_VOLUME_FLOOR_ROUNDING_MIN;
    return relativeFloor > AEROBIC_VOLUME_CATALOG_MINIMUM_MIN
        ? { floorMin: relativeFloor, source: 'athlete_history', sampleCount: durations.length, medianMin }
        : { ...CATALOG_AEROBIC_VOLUME_FLOOR, sampleCount: durations.length, medianMin };
}

/** The duration one exact workout identity must reach: never below its own catalog
 * minimum, and clamped to its catalog maximum so the floor always stays attainable. */
export function aerobicVolumeFloorForWorkout(workoutId: string, floor: AerobicVolumeFloor | null | undefined): number | undefined {
    const duration = WORKOUTS_BY_ID.get(workoutId)?.duration;
    if (!duration) return undefined;
    if (!floor) return duration.minimumMin;
    return Math.max(duration.minimumMin, Math.min(floor.floorMin, duration.maximumMin));
}
