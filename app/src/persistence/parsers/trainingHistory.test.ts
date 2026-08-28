import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDailyRecommendation, parseNormalizedGarminActivity } from './trainingHistory';

const activity = {
    activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 45,
    trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null, averageHr: 150,
    activityTrainingLoad: 115, intensityTag: 'hard', syncedAt: '2026-08-07T06:00:00Z',
};

const recommendation = {
    userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
    category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 2,
    createdAt: '2026-08-06T06:00:00Z', updatedAt: '2026-08-06T06:00:00Z',
    adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
};

describe('training-history persistence parsers', () => {
    it('accepts the documented schema-less legacy Garmin record', () => {
        const parsed = parseNormalizedGarminActivity(activity, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1', durationMin: 45 } });
    });

    it('rejects malformed activity dates instead of normalizing them', () => {
        const parsed = parseNormalizedGarminActivity({ ...activity, date: '2026-02-30' }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ field: 'date', code: 'invalid-date' }] });
    });

    it('rejects an unknown future activity schema', () => {
        const parsed = parseNormalizedGarminActivity({ ...activity, schemaVersion: 3 }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 3 }] });
    });

    it('surfaces enriched schema-less telemetry without changing availability', () => {
        const backendFixture = JSON.parse(readFileSync(
            new URL('../../../../tests/fixtures/normalized_activity_enriched.json', import.meta.url),
            'utf8',
        ));
        const parsed = parseNormalizedGarminActivity(backendFixture, 'users/u1/activities/999', '999');

        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                normalizedPower: 229,
                powerInZones: [{ zoneNumber: 1, secondsInZone: 300 }],
                laps: [{ lapIndex: 1, durationSeconds: 900, averagePowerWatts: 250 }],
            },
        });
    });

    it('preserves valid running dynamics from persisted running activities', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'trail_running',
            runningDynamics: {
                groundContactTimeMs: 238,
                groundContactBalanceLeftPct: 49.6,
                verticalOscillationCm: 8.2,
                verticalRatioPct: 7.1,
                strideLengthM: 1.18,
                avgRunningPowerWatts: 285,
                maxRunningPowerWatts: 410,
            },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                runningDynamics: {
                    groundContactTimeMs: 238,
                    groundContactBalanceLeftPct: 49.6,
                    verticalOscillationCm: 8.2,
                    verticalRatioPct: 7.1,
                    strideLengthM: 1.18,
                    avgRunningPowerWatts: 285,
                    maxRunningPowerWatts: 410,
                },
            },
        });
    });

    it('does not expose running dynamics for non-running activities', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            runningDynamics: { avgRunningPowerWatts: 285 },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.runningDynamics).toBeUndefined();
    });

    it('drops corrupt running dynamics while preserving the base activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'running',
            runningDynamics: { groundContactTimeMs: '238', groundContactBalanceLeftPct: 149.6 },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.runningDynamics).toBeUndefined();
    });

    it('drops running dynamics with a below-range balance or vertical ratio', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'running',
            runningDynamics: { groundContactBalanceLeftPct: 10, verticalRatioPct: 0.5 },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.runningDynamics).toBeUndefined();
    });

    it('drops zero-valued running-dynamics sentinels while preserving the base activity', () => {
        const strictlyPositiveFields = [
            'groundContactTimeMs',
            'verticalOscillationCm',
            'strideLengthM',
            'avgRunningPowerWatts',
            'maxRunningPowerWatts',
        ] as const;

        for (const field of strictlyPositiveFields) {
            const parsed = parseNormalizedGarminActivity({
                ...activity,
                type: 'running',
                runningDynamics: { [field]: 0 },
            }, 'users/u1/activities/a-1', 'a-1');

            expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
            if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
            expect(parsed.data.runningDynamics).toBeUndefined();
        }
    });

    it('drops corrupt optional telemetry while preserving the base activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            powerInZones: [{ zoneNumber: 'two', secondsInZone: 1200 }],
            normalizedPower: '229',
            laps: [{ lapIndex: 1, durationSeconds: '900' }],
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.powerInZones).toBeUndefined();
        expect(parsed.data.normalizedPower).toBeUndefined();
        expect(parsed.data.laps).toBeUndefined();
    });

    it('preserves valid strength exercise sets and training effect metadata', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'strength_training',
            primaryBenefit: 'TEMPO',
            trainingEffectLabel: 'AEROBIC_BASE',
            epoc: 42,
            recoveryTimeHours: 24,
            exerciseSets: [
                {
                    setOrder: 0,
                    setType: 'warmup',
                    repetitionCount: 10,
                    weightKg: 20,
                    exerciseCategory: 'bench_press',
                    exerciseName: 'barbell_bench_press',
                    durationSeconds: 30,
                    restDurationSeconds: 60,
                },
                {
                    setOrder: 1,
                    setType: 'active',
                    repetitionCount: 5,
                    weightKg: 80,
                    exerciseName: 'bench_press',
                },
            ],
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                activityId: 'a-1',
                primaryBenefit: 'TEMPO',
                trainingEffectLabel: 'AEROBIC_BASE',
                epoc: 42,
                recoveryTimeHours: 24,
                exerciseSets: [
                    {
                        setOrder: 0,
                        setType: 'warmup',
                        repetitionCount: 10,
                        weightKg: 20,
                        exerciseCategory: 'bench_press',
                        exerciseName: 'barbell_bench_press',
                        durationSeconds: 30,
                        restDurationSeconds: 60,
                    },
                    {
                        setOrder: 1,
                        setType: 'active',
                        repetitionCount: 5,
                        weightKg: 80,
                        exerciseName: 'bench_press',
                    },
                ],
            },
        });
    });

    it('drops corrupt exercise sets while preserving the base activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'strength_training',
            exerciseSets: [
                { setOrder: 'not-a-number' },
            ],
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.exerciseSets).toBeUndefined();
    });

    it('parses supported recommendation schemas and rejects future ones', () => {
        expect(parseDailyRecommendation(recommendation, 'users/u1/daily_recommendations/2026-08-06')).toMatchObject({ status: 'AVAILABLE', data: { date: '2026-08-06' } });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 3 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit' }] });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 4 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 4 }] });
    });

    it('preserves a valid exact Phase 9 engine verdict without changing the historical schema version', () => {
        const parsed = parseDailyRecommendation(
            { ...recommendation, engineVerdict: 'advisory' },
            'users/u1/daily_recommendations/2026-08-06',
        );
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { mode: 'train', engineVerdict: 'advisory', schemaVersion: 2 } });
    });

    it('rejects an invalid exact engine verdict instead of falling back to mode', () => {
        const parsed = parseDailyRecommendation(
            { ...recommendation, engineVerdict: 'maybe' },
            'users/u1/daily_recommendations/2026-08-06',
        );
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-engine-verdict', field: 'engineVerdict' }] });
    });
});
