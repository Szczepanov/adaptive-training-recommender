import { describe, expect, it } from 'vitest';
import {
    AEROBIC_VOLUME_CATALOG_MINIMUM_MIN,
    aerobicVolumeFloorForWorkout,
    CATALOG_AEROBIC_VOLUME_FLOOR,
    resolveAerobicVolumeFloor,
    type AerobicFloorEvidence,
} from './aerobicVolumeFloor';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { SessionTemplate } from './models';

const AS_OF = '2026-09-24';

function session(daysAgo: number, durationMin: number, modality: SessionTemplate['modality'] = 'Cycling', extra: Partial<AerobicFloorEvidence> = {}): AerobicFloorEvidence {
    return {
        date: addDaysToLocalDateString(AS_OF, -daysAgo),
        modality,
        trainingRecordLike: { type: `${modality} Easy Endurance`, duration_min: durationMin, training_effect: 2, intensity_tag: 'easy' },
        ...extra,
    };
}

const ESTABLISHED_CYCLIST = [2, 5, 8, 11, 14, 17, 20, 23].map(daysAgo => session(daysAgo, 60));

describe('resolveAerobicVolumeFloor (#757)', () => {
    it('falls back to the catalog minimum for a new user with no history', () => {
        expect(AEROBIC_VOLUME_CATALOG_MINIMUM_MIN).toBe(30);
        expect(resolveAerobicVolumeFloor([], AS_OF)).toEqual(CATALOG_AEROBIC_VOLUME_FLOOR);
    });

    it('falls back to the catalog minimum with fewer than four qualifying sessions', () => {
        const floor = resolveAerobicVolumeFloor([1, 3, 5].map(daysAgo => session(daysAgo, 90)), AS_OF);
        expect(floor).toMatchObject({ floorMin: 30, source: 'catalog_minimum', sampleCount: 3, medianMin: null });
    });

    it('raises the floor to 0.75 x median for an established 60-min cyclist', () => {
        expect(resolveAerobicVolumeFloor(ESTABLISHED_CYCLIST, AS_OF))
            .toEqual({ floorMin: 45, source: 'athlete_history', sampleCount: 8, medianMin: 60 });
    });

    it('keeps the catalog minimum for a novice whose sessions are 30-35 min', () => {
        const floor = resolveAerobicVolumeFloor([30, 30, 35, 30, 35, 30].map((minutes, index) => session(index * 3 + 1, minutes)), AS_OF);
        expect(floor).toMatchObject({ floorMin: 30, source: 'catalog_minimum', sampleCount: 6, medianMin: 30 });
    });

    it('uses the median, so one long ride cannot ratchet the floor', () => {
        const floor = resolveAerobicVolumeFloor([40, 40, 40, 40, 240].map((minutes, index) => session(index + 1, minutes)), AS_OF);
        expect(floor).toMatchObject({ floorMin: 30, medianMin: 40 });
    });

    it('rounds to the nearest 5 minutes', () => {
        // 0.75 x 50 = 37.5 -> 40; 0.75 x 70 = 52.5 -> 55
        expect(resolveAerobicVolumeFloor([1, 2, 3, 4].map(daysAgo => session(daysAgo, 50)), AS_OF).floorMin).toBe(40);
        expect(resolveAerobicVolumeFloor([1, 2, 3, 4].map(daysAgo => session(daysAgo, 70)), AS_OF).floorMin).toBe(55);
    });

    it('builds one athlete-level floor across aerobic modalities', () => {
        const mixed = [session(1, 60, 'Cycling'), session(3, 60, 'Running'), session(5, 60, 'Walking'), session(7, 60, 'Swimming')];
        expect(resolveAerobicVolumeFloor(mixed, AS_OF)).toMatchObject({ floorMin: 45, sampleCount: 4 });
    });

    it('excludes readiness-modified, sub-minimum, non-aerobic and out-of-window evidence', () => {
        const noise = [
            session(1, 60, 'Cycling', { isReadinessModifiedDose: true }),
            session(2, 20, 'Walking'),
            session(3, 60, 'Strength'),
            session(0, 60),
            session(29, 60),
            { date: addDaysToLocalDateString(AS_OF, -4), trainingRecordLike: { type: 'Unknown', duration_min: 60, training_effect: 2, intensity_tag: 'easy' } },
        ];
        const floor = resolveAerobicVolumeFloor([...noise, ...[5, 6, 7].map(daysAgo => session(daysAgo, 60))], AS_OF);
        expect(floor).toMatchObject({ source: 'catalog_minimum', sampleCount: 3 });
        expect(resolveAerobicVolumeFloor([...noise, ...[5, 6, 7, 28].map(daysAgo => session(daysAgo, 60))], AS_OF))
            .toMatchObject({ floorMin: 45, sampleCount: 4 });
    });

    it('prefers an explicit durationMin over the training record duration', () => {
        const sessions = [1, 2, 3, 4].map(daysAgo => session(daysAgo, 30, 'Cycling', { durationMin: 80 }));
        expect(resolveAerobicVolumeFloor(sessions, AS_OF).floorMin).toBe(60);
    });
});

describe('aerobicVolumeFloorForWorkout (#757)', () => {
    it('returns the catalog minimum without an athlete floor and undefined for unknown workouts', () => {
        expect(aerobicVolumeFloorForWorkout('cycling_zone2_standard_01', null)).toBe(30);
        expect(aerobicVolumeFloorForWorkout('not_a_workout', CATALOG_AEROBIC_VOLUME_FLOOR)).toBeUndefined();
    });

    it('applies the athlete floor and clamps it to each workout catalog maximum', () => {
        const high = { floorMin: 85, source: 'athlete_history' as const, sampleCount: 8, medianMin: 115 };
        expect(aerobicVolumeFloorForWorkout('cycling_zone2_standard_01', high)).toBe(85);
        expect(aerobicVolumeFloorForWorkout('walking_brisk_continuous_01', high)).toBe(75);
        expect(aerobicVolumeFloorForWorkout('running_easy_continuous_01', high)).toBe(70);
    });
});
