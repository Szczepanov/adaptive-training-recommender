import { describe, it, expect } from 'vitest';
import contractFixture from '../../../tests/fixtures/contracts/fit_workout_identity_v2.json';
import {
    FIT_WORKOUT_FINGERPRINT_VERSION,
    computeFitWorkoutIdentity,
    computeFitWorkoutFingerprint,
    computeWorkoutTemplateFingerprint,
    canonicalSerializeFitWorkoutPayload,
    type FitWorkoutStepEvidence,
} from './fitWorkoutIdentity';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';
import { exportWorkoutPrescriptionToJson } from '../utils/workoutJsonExport';
import type { WorkoutPrescription } from '../workouts/models';

describe('fitWorkoutIdentity', () => {
    describe('shared cross-language contract fixture parity', () => {
        for (const testCase of contractFixture.cases) {
            it(`matches contract case: ${testCase.id}`, async () => {
                if ('workout' in testCase) {
                    const context = 'athleteFtpWatts' in testCase
                        ? { athleteFtpWatts: testCase.athleteFtpWatts }
                        : undefined;
                    const result = await computeWorkoutTemplateFingerprint(
                        testCase.workout as unknown as CanonicalWorkoutExport,
                        context,
                    );
                    expect(result.fingerprint).toBe(testCase.expectedFingerprint);
                    expect(result.kind).toBe(testCase.expectedKind);
                } else {
                    const result = await computeFitWorkoutIdentity(
                        testCase.workoutName,
                        testCase.observedStepIndices,
                        [],
                    );
                    if (testCase.expectedFingerprint === null) {
                        expect(result).toBeNull();
                    } else {
                        expect(result).not.toBeNull();
                        expect(result!.fingerprint).toBe(testCase.expectedFingerprint);
                        expect(result!.kind).toBe(testCase.expectedKind);
                    }
                }
            });
        }
    });

    describe('canonical serialization & normalization', () => {
        it('sorts keys deterministically and handles null/primitives', () => {
            const a = { b: 1, a: 2, c: [3, { z: 1, y: 2 }] };
            const serialized = canonicalSerializeFitWorkoutPayload(a);
            expect(serialized).toBe('{"a":2,"b":1,"c":[3,{"y":2,"z":1}]}');
        });

        it('is case- and whitespace-insensitive for workout name', async () => {
            const a = await computeFitWorkoutIdentity('  VO2  Intervals ', [0, 1]);
            const b = await computeFitWorkoutIdentity('vo2 intervals', [0, 1]);
            expect(a?.fingerprint).toBe(b?.fingerprint);
        });

        it('step definition order is normalized by messageIndex', async () => {
            const step0: FitWorkoutStepEvidence = {
                messageIndex: 0,
                name: 'Warmup',
                durationType: 'time',
                durationValue: 300,
                intensity: 'warmup',
            };
            const step1: FitWorkoutStepEvidence = {
                messageIndex: 1,
                name: 'Interval',
                durationType: 'time',
                durationValue: 600,
                intensity: 'active',
            };

            const forward = await computeFitWorkoutIdentity('Test', [], [step0, step1]);
            const reversed = await computeFitWorkoutIdentity('Test', [], [step1, step0]);
            expect(forward?.fingerprint).toBe(reversed?.fingerprint);
            expect(forward?.kind).toBe('semantic_definition');
        });

        it('returns null for empty workout with no name and no steps', async () => {
            const result = await computeFitWorkoutIdentity(null, [], []);
            expect(result).toBeNull();
        });

        it('convenience computeFitWorkoutFingerprint returns only fingerprint string', async () => {
            const fp = await computeFitWorkoutFingerprint('Morning Run', [0]);
            expect(fp).toMatch(new RegExp(`^${FIT_WORKOUT_FINGERPRINT_VERSION}:[0-9a-f]{32}$`));
        });
    });

    describe('FTP-relative identity context', () => {
        it('fails closed when a cycling %FTP template is fingerprinted without the FTP used by Garmin export', async () => {
            const ftpCase = contractFixture.cases.find(testCase => testCase.id === 'cycling_ftp_context');
            expect(ftpCase && 'workout' in ftpCase).toBe(true);
            if (!ftpCase || !('workout' in ftpCase)) return;

            await expect(
                computeWorkoutTemplateFingerprint(ftpCase.workout as unknown as CanonicalWorkoutExport),
            ).rejects.toThrow('requires the athlete FTP used for Garmin export');
        });
    });

    describe('catalog prescriptions & external sessions', () => {
        it('computes valid semantic fingerprints for exported WorkoutPrescription', async () => {
            const prescription: WorkoutPrescription = {
                id: 'p1',
                userId: 'user-1',
                date: '2026-08-17',
                workoutId: 'full_body_strength_a',
                workoutVersion: 1,
                variantId: 'full',
                targetDurationMin: 60,
                adjustedBlocks: [],
                displayBlocks: [
                    {
                        id: 'b1',
                        name: 'Main Strength',
                        role: 'main',
                        steps: [
                            {
                                id: 's1',
                                name: 'Barbell Back Squat',
                                dose: '4 x 6 @ RPE 8',
                                rest: '2.5 min',
                                targets: ['RPE 8', 'Controlled eccentric'],
                                cues: ['Chest tall', 'Drive mid-foot'],
                                stopConditions: ['Knee valgus collapse'],
                            },
                        ],
                    },
                ],
                rationale: [],
                adjustmentReasons: [],
                source: { recommendationEngineVersion: '1.0.0' },
                status: 'recommended',
            };

            const canonical = exportWorkoutPrescriptionToJson(prescription, 'strength', 'full_body_strength');
            const identity = await computeWorkoutTemplateFingerprint(canonical);
            expect(identity.kind).toBe('semantic_definition');
            expect(identity.fingerprint).toMatch(new RegExp(`^${FIT_WORKOUT_FINGERPRINT_VERSION}:[0-9a-f]{32}$`));
        });
    });
});
