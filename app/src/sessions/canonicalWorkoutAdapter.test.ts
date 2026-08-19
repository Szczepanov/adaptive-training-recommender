import { describe, expect, it } from 'vitest';
import { isCanonicalWorkoutExport, adaptCanonicalWorkoutToSessionDefinition } from './canonicalWorkoutAdapter';
import { validateSessionDefinition } from './validation';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

describe('canonicalWorkoutAdapter', () => {
    it('correctly identifies canonical workout export payloads', () => {
        const canonical: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Test Workout',
            workoutId: 'test_workout',
            modality: 'strength',
            targetDurationMin: 45,
            blocks: [],
            exportedAt: new Date().toISOString(),
        };

        expect(isCanonicalWorkoutExport(canonical)).toBe(true);
        expect(isCanonicalWorkoutExport({ schemaVersion: 1, title: 'Session', blocks: [] })).toBe(false);
        expect(isCanonicalWorkoutExport(null)).toBe(false);
        expect(isCanonicalWorkoutExport('string')).toBe(false);
    });

    it('adapts a strength workout export into a valid SessionDefinition', () => {
        const exportPayload: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Full Body Strength A',
            workoutId: 'full_body_strength_a',
            modality: 'strength',
            targetDurationMin: 60,
            category: 'full_body_strength',
            summary: 'Primary systemic strength session.',
            blocks: [
                {
                    id: 'b1',
                    name: 'Main Strength',
                    role: 'main',
                    steps: [
                        {
                            id: 's1',
                            name: 'Barbell Back Squat',
                            exerciseId: 'barbell_back_squat',
                            sets: 4,
                            repetitions: 6,
                            weightKg: 100,
                            targetRpe: 8,
                            restAfterSec: 180,
                            cues: ['Chest tall', 'Drive mid-foot'],
                            stopConditions: ['Knee valgus collapse'],
                        },
                    ],
                },
            ],
            exportedAt: '2026-08-19T10:00:00.000Z',
        };

        const sessionDef = adaptCanonicalWorkoutToSessionDefinition(exportPayload);
        expect(sessionDef.schemaVersion).toBe(1);
        expect(sessionDef.id).toBe('full_body_strength_a');
        expect(sessionDef.title).toBe('Full Body Strength A');
        expect(sessionDef.intent).toBe('training');
        expect(sessionDef.dominantModality).toBe('strength');
        expect(sessionDef.duration).toEqual({ min: 60, max: 60 });
        expect(sessionDef.blocks).toHaveLength(1);

        const step = sessionDef.blocks[0].steps[0];
        expect(step.title).toBe('Barbell Back Squat');
        expect(step.exerciseRef).toEqual({ kind: 'catalog', exerciseId: 'barbell_back_squat' });
        expect(step.dose).toEqual({ kind: 'repetition', sets: 4, reps: 6 });
        expect(step.load).toEqual({ kind: 'mass', kg: 100 });
        expect(step.effort).toEqual({ rpe: 8 });
        expect(step.rest).toBe(180);
        expect(step.stopConditions).toEqual(['Knee valgus collapse']);
        expect(step.notes).toBe('Cues: Chest tall; Drive mid-foot');

        const validation = validateSessionDefinition(sessionDef);
        expect(validation.ok).toBe(true);
    });

    it('adapts an endurance interval workout export into a valid SessionDefinition', () => {
        const exportPayload: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'VO2 30/15 Repeated Aerobic Power',
            workoutId: 'vo2_30_15',
            modality: 'cycling',
            targetDurationMin: 60,
            blocks: [
                {
                    id: 'b-warm',
                    name: 'Warmup',
                    role: 'warmup',
                    steps: [
                        {
                            name: 'Warm-up spin',
                            durationSeconds: 900,
                            targets: ['140-180 W, RPE 2-4'],
                        },
                    ],
                },
                {
                    id: 'b-main',
                    name: 'VO2 Sets',
                    role: 'main',
                    steps: [
                        {
                            name: '30-second VO2 work',
                            durationSeconds: 30,
                            sets: 3,
                            repetitions: 10,
                            restAfterSec: 15,
                            targets: ['320-350 W'],
                            recoveryTarget: '150-180 W',
                            notes: 'Focus on high cadence and rapid aerobic uptake.',
                        },
                    ],
                },
            ],
            exportedAt: '2026-08-19T10:00:00.000Z',
        };

        const sessionDef = adaptCanonicalWorkoutToSessionDefinition(exportPayload);
        expect(sessionDef.blocks).toHaveLength(2);
        expect(sessionDef.blocks[0].role).toBe('warmup');
        expect(sessionDef.blocks[1].role).toBe('main');

        const warmupStep = sessionDef.blocks[0].steps[0];
        expect(warmupStep.dose).toEqual({ kind: 'duration', seconds: 900 });
        expect(warmupStep.notes).toBe('Targets: 140-180 W, RPE 2-4');

        const vo2Step = sessionDef.blocks[1].steps[0];
        expect(vo2Step.dose).toEqual({ kind: 'repetition', sets: 3, reps: 10 });
        expect(vo2Step.rest).toBe(15);
        expect(vo2Step.notes).toContain('Focus on high cadence');
        expect(vo2Step.notes).toContain('Targets: 320-350 W');
        expect(vo2Step.notes).toContain('Recovery target: 150-180 W');

        const validation = validateSessionDefinition(sessionDef);
        expect(validation.ok).toBe(true);
    });

    it('adapts % 1RM loads and dose strings correctly', () => {
        const exportPayload: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Deadlift Focus',
            workoutId: 'deadlift_focus',
            modality: 'strength',
            targetDurationMin: 45,
            blocks: [
                {
                    name: 'Main',
                    role: 'main',
                    steps: [
                        {
                            name: 'Deadlift',
                            exerciseId: 'conventional_deadlift',
                            dose: '3 x 5 reps',
                            weightPercent1Rm: 80,
                        },
                    ],
                },
            ],
            exportedAt: '2026-08-19T10:00:00.000Z',
        };

        const sessionDef = adaptCanonicalWorkoutToSessionDefinition(exportPayload);
        const step = sessionDef.blocks[0].steps[0];
        expect(step.dose).toEqual({ kind: 'repetition', sets: 3, reps: 5 });
        expect(step.load).toEqual({ kind: 'percent_one_rm', percent: 80 });

        const validation = validateSessionDefinition(sessionDef);
        expect(validation.ok).toBe(true);
    });

    it('maps intent correctly for recovery, testing, competition, and rehab', () => {
        expect(adaptCanonicalWorkoutToSessionDefinition({
            schemaVersion: 'canonical_workout_v1',
            title: 'Recovery Spin',
            workoutId: 'recovery_spin',
            modality: 'recovery',
            targetDurationMin: 30,
            blocks: [],
            exportedAt: '2026-08-19',
        }).intent).toBe('recovery');

        expect(adaptCanonicalWorkoutToSessionDefinition({
            schemaVersion: 'canonical_workout_v1',
            title: 'FTP Test',
            workoutId: 'ftp_test',
            modality: 'cycling',
            category: 'test',
            targetDurationMin: 60,
            blocks: [],
            exportedAt: '2026-08-19',
        }).intent).toBe('testing');

        expect(adaptCanonicalWorkoutToSessionDefinition({
            schemaVersion: 'canonical_workout_v1',
            title: 'Gran Fondo Race',
            workoutId: 'gran_fondo',
            modality: 'cycling',
            category: 'competition',
            targetDurationMin: 180,
            blocks: [],
            exportedAt: '2026-08-19',
        }).intent).toBe('competition');
    });

    it('adapts explosive lift and multi-set strength sessions with RPE ranges and clean non-redundant notes', () => {
        const exportPayload: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Low-Fatigue Power and Strength',
            workoutId: 'low_fatigue_power',
            modality: 'strength',
            targetDurationMin: 30,
            summary: 'Maintain strength and explosive qualities with very low fatigue. Leave approximately 3-5 repetitions in reserve and finish feeling athletic rather than trained down.\n\nReduced version:\nRemove loaded lower-body work and perform only upper body, trunk and optional calf/soleus isometrics for 20-30 min.\n\nIf weights are unavailable:\nIf weights are unavailable, use low-fatigue bodyweight split squats, push-ups, pull-ups if available, trunk work and calf isometrics. Do not create high-repetition leg soreness.',
            blocks: [
                {
                    name: 'Main Block',
                    role: 'main',
                    steps: [
                        {
                            name: 'Explosive lift',
                            durationSeconds: 480,
                            targets: ['4 x 2 fast repetitions, RPE 5-6'],
                            notes: 'Use a familiar Olympic-lift derivative or another familiar explosive free-weight movement. Every repetition must be fast.',
                        },
                        {
                            name: 'Lower-body strength',
                            durationSeconds: 600,
                            targets: ['2 x 3-5 squat or split-squat repetitions plus 2 x 4-6 hinge repetitions, RPE 5-6'],
                            notes: 'No grinding and no soreness hunting.',
                        },
                        {
                            name: 'Upper body and trunk',
                            durationSeconds: 720,
                            targets: ['2-3 easy-to-moderate push/pull sets plus trunk work'],
                            notes: 'Low fatigue. Calf or soleus isometrics may be included.',
                        },
                    ],
                },
            ],
            exportedAt: '2026-08-19T10:00:00.000Z',
        };

        const sessionDef = adaptCanonicalWorkoutToSessionDefinition(exportPayload);
        expect(sessionDef.summary).toContain('Reduced version:');
        expect(sessionDef.summary).toContain('If weights are unavailable:');

        const step1 = sessionDef.blocks[0].steps[0];
        expect(step1.title).toBe('Explosive lift');
        expect(step1.dose).toEqual({ kind: 'repetition', sets: 4, reps: 2 });
        expect(step1.effort).toEqual({ rpe: { min: 5, max: 6 } });
        expect(step1.notes).toBe('Use a familiar Olympic-lift derivative or another familiar explosive free-weight movement. Every repetition must be fast.');

        const step2 = sessionDef.blocks[0].steps[1];
        expect(step2.title).toBe('Lower-body strength');
        expect(step2.dose).toEqual({ kind: 'repetition', sets: 2, reps: { min: 3, max: 5 } });
        expect(step2.effort).toEqual({ rpe: { min: 5, max: 6 } });
        expect(step2.notes).toContain('No grinding and no soreness hunting.');

        const step3 = sessionDef.blocks[0].steps[2];
        expect(step3.title).toBe('Upper body and trunk');
        expect(step3.dose).toEqual({ kind: 'duration', seconds: 720 });
        expect(step3.notes).toContain('Low fatigue. Calf or soleus isometrics may be included.');
        expect(step3.notes).toContain('Targets: 2-3 easy-to-moderate push/pull sets plus trunk work');

        const validation = validateSessionDefinition(sessionDef);
        expect(validation.ok).toBe(true);
    });
});
