import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from './trainingHistory';
import { resolveWeeklyAerobicDoseEnvelope } from './weeklyAerobicDose';

const asOfDate = '2026-09-29';

function ride(date: string, durationMin: number, category: 'Easy Endurance' | 'Hard Endurance' = 'Easy Endurance'): CompletedExposure {
    return {
        date, modality: 'Cycling', category,
        trainingRecordLike: { type: category, duration_min: durationMin, training_effect: 2, intensity_tag: category === 'Easy Endurance' ? 'easy' : 'hard' },
        costProfile: { systemic: 0.3, cardiovascular: 0.4, lowerBody: 0.3, upperBody: 0, impactTissue: 0, neuromuscular: 0.1 },
    };
}

function establishedEnvelope(exposures: CompletedExposure[], phaseName = 'Base') {
    return resolveWeeklyAerobicDoseEnvelope({
        exposures, asOfDate, observedWindowDays: 28, priorities: ['endurance'], phaseName,
        trainingAgeEstablished: true,
    });
}

describe('weekly aerobic dose envelope (#806)', () => {
    it('uses the safe guideline fallback for novice or thin history', () => {
        const fallback = resolveWeeklyAerobicDoseEnvelope({
            exposures: [ride('2026-09-20', 240)], asOfDate, observedWindowDays: 7,
            priorities: ['endurance'], phaseName: 'Build', trainingAgeEstablished: false,
        });
        expect(fallback).toMatchObject({
            source: 'guideline_fallback', floorMinutes: 150, targetMinutes: 150,
            upperMinutes: 300, longAnchor: null,
        });
    });

    it('uses a robust maintenance median and a higher observed target in endurance development', () => {
        const sessions = [
            ride('2026-09-02', 180), ride('2026-09-09', 210),
            ride('2026-09-16', 240), ride('2026-09-23', 300),
        ];
        expect(establishedEnvelope(sessions)).toMatchObject({
            source: 'athlete_history', modality: 'Cycling', weeklyMinutes: [180, 210, 240, 300],
            floorMinutes: 180, targetMinutes: 225, upperMinutes: 240, typicalSessionMinutes: 60,
        });
        expect(establishedEnvelope(sessions, 'Build')).toMatchObject({
            source: 'athlete_history', floorMinutes: 180, targetMinutes: 240, upperMinutes: 240,
        });
    });

    it('requires aerobic work in at least three observed weeks and does not infer capacity from time available', () => {
        const sparseWeeks = [ride('2026-09-02', 240), ride('2026-09-23', 300)];
        expect(establishedEnvelope(sparseWeeks).source).toBe('guideline_fallback');
        const lowVolume = establishedEnvelope([
            ride('2026-09-02', 60), ride('2026-09-09', 60), ride('2026-09-16', 60), ride('2026-09-23', 60),
        ]);
        expect(lowVolume).toMatchObject({ source: 'guideline_fallback', modality: null, floorMinutes: 150, targetMinutes: 150, upperMinutes: 300, longAnchor: null });
    });

    it('derives relative minutes from the dominant modality only', () => {
        const walking = (date: string): CompletedExposure => ({
            ...ride(date, 30), modality: 'Walking', trainingRecordLike: { type: 'Easy Endurance', duration_min: 30, training_effect: 2, intensity_tag: 'easy' },
        });
        const mixed = establishedEnvelope([
            ride('2026-09-02', 180), walking('2026-09-03'),
            ride('2026-09-09', 180), walking('2026-09-10'),
            ride('2026-09-16', 180), walking('2026-09-17'),
            ride('2026-09-23', 180),
        ]);
        expect(mixed.modality).toBe('Cycling');
        expect(mixed.weeklyMinutes).toEqual([180, 180, 180, 180]);
    });

    it('keeps swim-primary history on an exact swim anchor identity', () => {
        const swim = (date: string): CompletedExposure => ({
            ...ride(date, 180), modality: 'Swimming',
            trainingRecordLike: { type: 'Easy Endurance', duration_min: 180, training_effect: 2, intensity_tag: 'easy' },
        });
        const envelope = establishedEnvelope([
            swim('2026-09-02'), swim('2026-09-09'), swim('2026-09-16'), swim('2026-09-23'),
        ]);
        expect(envelope).toMatchObject({ modality: 'Swimming', longAnchor: { workoutId: 'swimming_easy_aerobic_01' } });
    });

    it('keeps quality sessions out of easy-volume minutes while retaining the primary-modality anchor', () => {
        const sessions = [
            ride('2026-09-02', 180), ride('2026-09-09', 210),
            ride('2026-09-16', 240), ride('2026-09-23', 300),
            ride('2026-09-24', 120, 'Hard Endurance'),
        ];
        expect(establishedEnvelope(sessions)).toMatchObject({
            weeklyMinutes: [180, 210, 240, 300],
            modality: 'Cycling',
            longAnchor: { workoutId: 'cycling_zone2_standard_01', durationMinutes: 60 },
        });
    });
});
