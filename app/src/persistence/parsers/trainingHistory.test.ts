import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArchivedRecommendation, parseDailyRecommendation, parseNormalizedGarminActivity } from './trainingHistory';

const archivedRecommendation = {
    revision: 1,
    templateId: 'rest_01',
    templateTitle: 'Total Rest',
    category: 'Rest',
    modality: 'None',
    mode: 'recover',
    rationale: 'Readiness gate withheld the imported session.',
    engineVerdict: 'defer',
    recommendationAudit: {
        externalPlan: { planId: 'autumn-block', revision: 2, sessionId: 'ride-1', contentHash: 'a'.repeat(64) },
    },
};

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

// Mirrors validV4Recommendation() in engine/validationRecommendation.test.ts -- a real v4
// document written since "persist recommendation knowledge lineage" always carries this
// shape (recommendationAudit.knowledgeLineage populated).
const recommendationV4 = {
    ...recommendation,
    date: '2026-08-31',
    schemaVersion: 4,
    recommendationAudit: {
        policyVersion: '2026-08-skr1-persisted-knowledge-lineage-v1',
        evaluatedAt: '2026-08-31T06:00:00Z',
        decisionContextRevision: 'history-v1:2026-08-31:7:none:none',
        safetyStatus: 'complete',
        history: {
            completedEventCount: 0,
            unmatchedEventCount: 0,
            sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
        },
        envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
        candidateScores: [],
        knowledgeLineage: [{ claimId: 'readiness.objective_mode_thresholds', version: 1 }],
    },
};

describe('training-history persistence parsers', () => {
    it('accepts the documented schema-less legacy Garmin record', () => {
        const parsed = parseNormalizedGarminActivity(activity, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1', durationMin: 45 } });
    });

    it('accepts and passes through startedAt/endedAt/fitWorkoutFingerprint/fitWorkoutFingerprintKind when present', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity, startedAt: '2026-08-06T06:00:00Z', endedAt: '2026-08-06T06:45:00Z',
            fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
            fitWorkoutFingerprintKind: 'semantic_definition',
        }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                startedAt: '2026-08-06T06:00:00Z',
                endedAt: '2026-08-06T06:45:00Z',
                fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
                fitWorkoutFingerprintKind: 'semantic_definition',
            },
        });
    });

    it('passes through the #809 stimulus/cost classification and drops unknown enum values', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity, intensityTag: 'easy', stimulusDomain: 'endurance', sessionCost: 'high',
            intensityEvidence: 'powerIntensityFactor', intensityClassificationVersion: 2,
        }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: { intensityTag: 'easy', stimulusDomain: 'endurance', sessionCost: 'high', intensityEvidence: 'powerIntensityFactor', intensityClassificationVersion: 2 },
        });
        const unknown = parseNormalizedGarminActivity({ ...activity, stimulusDomain: 'sprint', sessionCost: 'huge' }, 'users/u1/activities/a-1', 'a-1');
        expect(unknown.status).toBe('AVAILABLE');
        if (unknown.status === 'AVAILABLE') {
            expect(unknown.data.stimulusDomain).toBeUndefined();
            expect(unknown.data.sessionCost).toBeUndefined();
        }
    });

    it('omits startedAt/endedAt/fitWorkoutFingerprint rather than defaulting them when absent', () => {
        const parsed = parseNormalizedGarminActivity(activity, 'users/u1/activities/a-1', 'a-1');
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected AVAILABLE');
        expect(parsed.data).not.toHaveProperty('startedAt');
        expect(parsed.data).not.toHaveProperty('endedAt');
        expect(parsed.data).not.toHaveProperty('fitWorkoutFingerprint');
        expect(parsed.data).not.toHaveProperty('fitWorkoutFingerprintKind');
    });

    it('rejects a non-string fitWorkoutFingerprint', () => {
        const parsed = parseNormalizedGarminActivity({ ...activity, fitWorkoutFingerprint: 42 }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed.status).toBe('INVALID');
    });

    it('rejects an invalid fitWorkoutFingerprintKind', () => {
        const parsedInvalidString = parseNormalizedGarminActivity({ ...activity, fitWorkoutFingerprintKind: 'unknown_kind' }, 'users/u1/activities/a-1', 'a-1');
        expect(parsedInvalidString.status).toBe('INVALID');
        const parsedInvalidType = parseNormalizedGarminActivity({ ...activity, fitWorkoutFingerprintKind: 123 }, 'users/u1/activities/a-1', 'a-1');
        expect(parsedInvalidType.status).toBe('INVALID');
    });

    it('requires a valid v2 fingerprint whenever a Garmin evidence kind is present', () => {
        const missingFingerprint = parseNormalizedGarminActivity({
            ...activity,
            fitWorkoutFingerprintKind: 'semantic_definition',
        }, 'users/u1/activities/a-1', 'a-1');
        expect(missingFingerprint.status).toBe('INVALID');

        const malformedFingerprint = parseNormalizedGarminActivity({
            ...activity,
            fitWorkoutFingerprint: 'fit-workout-v1:legacy',
            fitWorkoutFingerprintKind: 'semantic_definition',
        }, 'users/u1/activities/a-1', 'a-1');
        expect(malformedFingerprint.status).toBe('INVALID');
    });

    it('keeps legacy fingerprint-only Garmin rows readable but non-promoted', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            fitWorkoutFingerprint: 'fit-workout-v1:legacy',
        }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected AVAILABLE');
        expect(parsed.data.fitWorkoutFingerprint).toBe('fit-workout-v1:legacy');
        expect(parsed.data.fitWorkoutFingerprintKind).toBeUndefined();
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

    it('parses lap distance and pace for running interval splits', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            type: 'running',
            laps: [
                { lapIndex: 1, durationSeconds: 180, averageHrBpm: 168, distanceMeters: 800, averageSpeedMps: 4.44 },
                { lapIndex: 2, durationSeconds: 120, averageHrBpm: 140 },
            ],
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                laps: [
                    { lapIndex: 1, durationSeconds: 180, distanceMeters: 800, averageSpeedMps: 4.44 },
                    { lapIndex: 2, durationSeconds: 120 },
                ],
            },
        });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.laps?.[1].distanceMeters).toBeUndefined();
    });

    it('drops a lap with a corrupt distance/pace field while keeping the rest of the activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            laps: [{ lapIndex: 1, durationSeconds: 180, distanceMeters: 'far' }],
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.laps).toBeUndefined();
    });

    it('preserves valid HR measurement metadata without changing base activity availability', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            hrMeasurement: {
                externalHrSensorPresent: null,
                sourceForActivity: 'unknown',
                provenanceConfidence: 'unknown',
                sensorTechnology: 'unknown',
                activityMotionRisk: 'moderate',
                coveragePct: null,
                longestGapSeconds: null,
                signalQuality: 'unknown',
                measurementConfidence: 'unknown',
                summaryCompatibility: 'unknown',
                artifactFlags: ['ASSESSMENT_UNAVAILABLE'],
                reasons: ['ASSESSMENT_UNAVAILABLE'],
                diagnosticVersion: '1.0.0',
            },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: { hrMeasurement: { measurementConfidence: 'unknown' } },
        });
    });

    it('drops malformed HR measurement metadata while preserving the base activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            hrMeasurement: { measurementConfidence: 'unreliable', coveragePct: 'bad' },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
        expect(parsed.data.hrMeasurement).toBeUndefined();
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

    it('parses valid activityResponse with segments, peaks, and steadyHalves', () => {
        const sampleResponse = {
            derivationVersion: 'multi-resolution-v1',
            segmentCountTotal: 2,
            segmentsTruncated: false,
            sourceResolution: { powerSeconds: 1.0, hrSeconds: 1.0, cadenceSeconds: 1.0 },
            segments: [
                {
                    segmentIndex: 1,
                    segmentType: 'work',
                    identitySource: 'fit_workout_step',
                    durationSeconds: 900,
                    evidenceConfidence: 'high',
                    averagePowerWatts: 230,
                    peak1sPowerWatts: 300,
                    peak5sPowerWatts: 280,
                    peak10sPowerWatts: 260,
                    averageHrBpm: 155,
                    endHrBpm: 158,
                    maxHrBpm: 162,
                    averageCadenceRpm: 92,
                    maxCadenceRpm: 102,
                    firstThirdPowerWatts: 228,
                    middleThirdPowerWatts: 231,
                    lastThirdPowerWatts: 232,
                    lastThirdHrBpm: 157,
                    prescribedTarget: { kind: 'power_3s_target', low: 220, high: 240, value: 0 },
                },
                {
                    segmentIndex: 2,
                    segmentType: 'recovery',
                    identitySource: 'fit_workout_step',
                    durationSeconds: 300,
                    evidenceConfidence: 'high',
                    averagePowerWatts: 110,
                },
            ],
            powerDurationPeaks: [
                { durationSeconds: 5, powerWatts: 380, confidence: 'high', elapsedBeforeSeconds: 1200, activityHalf: 'first' },
                { durationSeconds: 300, powerWatts: 240, confidence: 'high' },
            ],
            steadyHalves: {
                firstPowerWatts: 190,
                secondPowerWatts: 185,
                firstHrBpm: 140,
                secondHrBpm: 142,
                firstCadenceRpm: 90,
                secondCadenceRpm: 88,
            },
        };

        const parsed = parseNormalizedGarminActivity({
            ...activity,
            activityResponse: sampleResponse,
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.activityResponse).toEqual(sampleResponse);
    });

    it('rejects reserved reconciled step identity until a deterministic alignment contract exists', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                segmentCountTotal: 1,
                segmentsTruncated: false,
                sourceResolution: { powerSeconds: 1 },
                segments: [{
                    segmentIndex: 1,
                    segmentType: 'work',
                    identitySource: 'reconciled_workout_step',
                    durationSeconds: 600,
                    evidenceConfidence: 'high',
                    averagePowerWatts: 250,
                }],
                powerDurationPeaks: [],
            },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.activityResponse).toBeUndefined();
    });

    it('accepts the canonical 64-segment truncation boundary', () => {
        const segments = Array.from({ length: 64 }, (_, index) => ({
            segmentIndex: index + 1,
            segmentType: 'work' as const,
            identitySource: 'fit_workout_step' as const,
            durationSeconds: 60,
            evidenceConfidence: 'high' as const,
            averagePowerWatts: 250,
        }));
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                segmentCountTotal: 65,
                segmentsTruncated: true,
                sourceResolution: { powerSeconds: 1 },
                segments,
                powerDurationPeaks: [{ durationSeconds: 60, powerWatts: 320, confidence: 'high' }],
            },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.activityResponse?.segments).toHaveLength(64);
        expect(parsed.data.activityResponse?.segmentsTruncated).toBe(true);
        expect(parsed.data.activityResponse?.segmentCountTotal).toBe(65);
    });

    it('drops corrupt activityResponse while preserving base activity', () => {
        const parsed = parseNormalizedGarminActivity({
            ...activity,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                segments: 'not-an-array',
            },
        }, 'users/u1/activities/a-1', 'a-1');

        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.activityResponse).toBeUndefined();
    });

    it('drops activityResponse when nested optional evidence is malformed', () => {
        const validResponse = {
            derivationVersion: 'multi-resolution-v1',
            segmentCountTotal: 1,
            segmentsTruncated: false,
            sourceResolution: { powerSeconds: 1 },
            segments: [{
                segmentIndex: 1,
                segmentType: 'work',
                identitySource: 'fit_workout_step',
                durationSeconds: 600,
                evidenceConfidence: 'high',
                averagePowerWatts: 250,
                prescribedTarget: { kind: 'power_range_watts', low: 240, high: 260 },
            }],
            powerDurationPeaks: [{
                durationSeconds: 5,
                powerWatts: 400,
                confidence: 'high',
                activityHalf: 'first',
            }],
        };

        const malformedResponses = [
            { ...validResponse, derivationVersion: 'multi-resolution-v2' },
            { ...validResponse, sourceResolution: { powerSeconds: '1' } },
            { ...validResponse, segments: [{ ...validResponse.segments[0], averagePowerWatts: '250' }] },
            { ...validResponse, segments: [{ ...validResponse.segments[0], prescribedTarget: { kind: 'power_range_watts', low: '240', high: 260 } }] },
            { ...validResponse, powerDurationPeaks: [{ ...validResponse.powerDurationPeaks[0], activityHalf: 'middle' }] },
            { ...validResponse, powerDurationPeaks: [{ ...validResponse.powerDurationPeaks[0], durationSeconds: 600 }] },
            {
                ...validResponse,
                segmentCountTotal: 65,
                segmentsTruncated: true,
                segments: Array.from({ length: 65 }, (_, index) => ({
                    ...validResponse.segments[0],
                    segmentIndex: index + 1,
                })),
            },
            { ...validResponse, segmentCountTotal: 2 },
        ];

        for (const activityResponse of malformedResponses) {
            const parsed = parseNormalizedGarminActivity({
                ...activity,
                activityResponse,
            }, 'users/u1/activities/a-1', 'a-1');

            expect(parsed.status).toBe('AVAILABLE');
            if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
            expect(parsed.data.activityResponse).toBeUndefined();
        }
    });

    it('parses supported recommendation schemas and rejects future ones', () => {
        expect(parseDailyRecommendation(recommendation, 'users/u1/daily_recommendations/2026-08-06')).toMatchObject({ status: 'AVAILABLE', data: { date: '2026-08-06' } });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 3 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit' }] });
        // v4 (persisted knowledge lineage) is accepted through the same strict validator
        // once it carries a valid recommendationAudit.knowledgeLineage; without one it
        // fails schema validation, not the version gate.
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 4 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit' }, { field: 'recommendationAudit.knowledgeLineage' }] });
        expect(parseDailyRecommendation(recommendationV4, 'users/u1/daily_recommendations/2026-08-31'))
            .toMatchObject({ status: 'AVAILABLE', data: { date: '2026-08-31', schemaVersion: 4 } });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 5 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 5 }] });
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

    it('parses a well-formed recommendation revision archive with its external-plan claim', () => {
        const parsed = parseArchivedRecommendation(archivedRecommendation, 'users/u1/daily_recommendations/2026-09-20/revisions/1');
        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: {
                revision: 1,
                templateId: 'rest_01',
                mode: 'recover',
                engineVerdict: 'defer',
                recommendationAudit: {
                    externalPlan: { planId: 'autumn-block', revision: 2, sessionId: 'ride-1' },
                },
            },
        });
    });

    it('parses an archive without optional verdict, prescription, bindings or audit', () => {
        const { engineVerdict: _removedVerdict, recommendationAudit: _removedAudit, ...minimal } = archivedRecommendation;
        void _removedVerdict;
        void _removedAudit;
        const parsed = parseArchivedRecommendation(minimal, 'users/u1/daily_recommendations/2026-09-20/revisions/1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { revision: 1 } });
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.engineVerdict).toBeUndefined();
        expect(parsed.data.recommendationAudit).toBeUndefined();
    });

    it('rejects archives that fail any structural check instead of trusting them partially', () => {
        const path = 'users/u1/daily_recommendations/2026-09-20/revisions/1';
        expect(parseArchivedRecommendation(null, path)).toMatchObject({ status: 'INVALID' });
        expect(parseArchivedRecommendation({ ...archivedRecommendation, revision: 0 }, path))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'revision' }] });
        expect(parseArchivedRecommendation({ ...archivedRecommendation, templateId: '' }, path))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'templateId' }] });
        expect(parseArchivedRecommendation({ ...archivedRecommendation, mode: 'rest' }, path))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'mode' }] });
        expect(parseArchivedRecommendation({ ...archivedRecommendation, engineVerdict: 'maybe' }, path))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'engineVerdict' }] });
        expect(parseArchivedRecommendation({
            ...archivedRecommendation,
            recommendationAudit: { externalPlan: { planId: 'autumn-block', revision: 'two', sessionId: 'ride-1', contentHash: 'a'.repeat(64) } },
        }, path)).toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit.externalPlan' }] });
        expect(parseArchivedRecommendation({
            ...archivedRecommendation,
            recommendationAudit: { authoredOccurrence: { occurrenceId: 'occ-1', decision: 'reject' } },
        }, path)).toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit.authoredOccurrence' }] });
    });
});
