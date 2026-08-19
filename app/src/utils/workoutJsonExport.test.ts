import { describe, expect, it } from 'vitest';
import { exportWorkoutPrescriptionToJson, exportExternalSessionToJson, exportExternalSessionV2ToJson } from './workoutJsonExport';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';

describe('workoutJsonExport', () => {
    it('exports a strength workout prescription with parsed sets, reps, and cues', () => {
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

        const json = exportWorkoutPrescriptionToJson(prescription, 'strength', 'full_body_strength');
        expect(json.schemaVersion).toBe('canonical_workout_v1');
        expect(json.modality).toBe('strength');
        expect(json.blocks[0].steps[0].name).toBe('Barbell Back Squat');
        expect(json.blocks[0].steps[0].sets).toBe(4);
        expect(json.blocks[0].steps[0].repetitions).toBe(6);
        expect(json.blocks[0].steps[0].targetRpe).toBe(8);
        expect(json.blocks[0].steps[0].restAfterSec).toBe(150);
        expect(json.blocks[0].steps[0].cues).toEqual(['Chest tall', 'Drive mid-foot']);
        expect(json.blocks[0].steps[0].stopConditions).toEqual(['Knee valgus collapse']);
    });

    it('exports an external session with step intervals and recoveries', () => {
        const session: ExternalPlanSession = {
            id: 'ext-ride',
            title: 'Tempo 2x20',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 70, durationMax: 85, environment: 'outdoor', equipment: [] },
            prescription: {
                summary: '2x20 min tempo.',
                steps: [
                    { name: 'Warm-up', durationMin: 15 },
                    { name: 'Tempo block', durationMin: 20, repeat: 2, recoveryMin: 5, target: '85% FTP' },
                ],
            },
        };

        const json = exportExternalSessionToJson(session);
        expect(json.schemaVersion).toBe('canonical_workout_v1');
        expect(json.modality).toBe('cycling');
        expect(json.blocks[0].steps).toHaveLength(2);
        expect(json.blocks[0].steps[1].repetitions).toBe(2);
        expect(json.blocks[0].steps[1].durationSeconds).toBe(1200);
        expect(json.blocks[0].steps[1].restAfterSec).toBe(300);
    });

    it('exports a v2 external session directly from structured dose/effort/rest fields, no free-text parsing (M3.6)', () => {
        const session: ExternalPlanSessionV2 = {
            id: 'w1-vo2-v2',
            title: 'VO2 30/15 repeated aerobic power',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            definition: {
                schemaVersion: 1, id: 'w1-vo2-v2', revision: 1, title: 'VO2 30/15', summary: '3 sets of 10 x 30s/15s.', intent: 'training',
                blocks: [{
                    id: 'block-main', role: 'main', executionMode: 'sequential',
                    steps: [{
                        id: 'step-vo2', kind: 'exercise', title: 'VO2 rep',
                        exerciseRef: { kind: 'unresolved_free_text', name: 'VO2 rep' },
                        dose: { kind: 'duration', sets: 3, seconds: 30 },
                        rest: 15,
                        effort: { rpe: 9 },
                    }],
                }],
            },
        };

        const json = exportExternalSessionV2ToJson(session);
        expect(json.schemaVersion).toBe('canonical_workout_v1');
        expect(json.summary).toBe('3 sets of 10 x 30s/15s.');
        expect(json.blocks[0].steps).toHaveLength(1);
        expect(json.blocks[0].steps[0]).toMatchObject({
            name: 'VO2 rep', sets: 3, durationSeconds: 30, restAfterSec: 15, targetRpe: 9,
        });
    });

    it('exports a v2 external session with structured load (mass, percent_one_rm, percent_max)', () => {
        const session: ExternalPlanSessionV2 = {
            id: 'w1-strength-loaded',
            title: 'Lower Body Strength',
            priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'strength', intensity: 'hard', durationMin: 50, durationMax: 60, environment: 'indoor', equipment: ['free_weights'] },
            definition: {
                schemaVersion: 1, id: 'w1-strength-loaded', revision: 1, title: 'Lower Body Strength', intent: 'training',
                blocks: [{
                    id: 'block-main', role: 'main', executionMode: 'sequential',
                    steps: [
                        {
                            id: 'step-squat-mass', kind: 'exercise', title: 'Squat Mass',
                            exerciseRef: { kind: 'unresolved_free_text', name: 'Back Squat' },
                            dose: { kind: 'repetition', sets: 4, reps: { min: 6, max: 8 } },
                            load: { kind: 'mass', kg: { min: 95, max: 105 } },
                            rest: 180,
                        },
                        {
                            id: 'step-deadlift-1rm', kind: 'exercise', title: 'Deadlift 1RM',
                            exerciseRef: { kind: 'unresolved_free_text', name: 'Deadlift' },
                            dose: { kind: 'repetition', sets: 3, reps: 5 },
                            load: { kind: 'percent_one_rm', percent: 82.5 },
                            rest: 180,
                        },
                        {
                            id: 'step-press-max', kind: 'exercise', title: 'Press Max',
                            exerciseRef: { kind: 'unresolved_free_text', name: 'Overhead Press' },
                            dose: { kind: 'repetition', sets: 3, reps: 8 },
                            load: { kind: 'percent_max', percent: 75 },
                            rest: 120,
                        },
                    ],
                }],
            },
        };

        const json = exportExternalSessionV2ToJson(session);
        expect(json.blocks[0].steps).toHaveLength(3);
        expect(json.blocks[0].steps[0]).toMatchObject({
            name: 'Squat Mass',
            sets: 4,
            repetitions: 7,
            weightKg: 100,
            restAfterSec: 180,
        });
        expect(json.blocks[0].steps[1]).toMatchObject({
            name: 'Deadlift 1RM',
            sets: 3,
            repetitions: 5,
            weightPercent1Rm: 82.5,
            restAfterSec: 180,
        });
        expect(json.blocks[0].steps[2]).toMatchObject({
            name: 'Press Max',
            sets: 3,
            repetitions: 8,
            weightPercent1Rm: 75,
            restAfterSec: 120,
        });
    });

    it('exports a multi-set 30/15 workout with explicit structured fields', () => {
        const session: ExternalPlanSession = {
            id: 'w1-vo2',
            title: 'VO2 30/15 repeated aerobic power',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: {
                summary: '3 sets of 10 x 30s/15s.',
                steps: [
                    { name: 'Warm-up', durationMin: 20, target: '140-180 W' },
                    { name: 'VO2 rep', durationSec: 30, recoverySec: 15, repeat: 10, sets: 3, setRecoveryMin: 4, target: '320-350 W' },
                    { name: 'Cooldown', durationMin: 10, target: '140 W' },
                ],
            },
        };

        const json = exportExternalSessionToJson(session);
        expect(json.blocks[0].steps).toHaveLength(3);
        const vo2Step = json.blocks[0].steps[1];
        expect(vo2Step.name).toBe('VO2 rep');
        expect(vo2Step.durationSeconds).toBe(30);
        expect(vo2Step.restAfterSec).toBe(15);
        expect(vo2Step.repetitions).toBe(10);
        expect(vo2Step.sets).toBe(3);
        expect(vo2Step.setRecoverySec).toBe(240);
        expect(vo2Step.targets).toEqual(['320-350 W']);
    });

    it('infers recovery, sets, and set-recovery from notes when imported plan omits explicit recovery fields', () => {
        const session: ExternalPlanSession = {
            id: 'w1-vo2-notes',
            title: 'VO2 30/15 repeated aerobic power',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: {
                summary: 'Accumulate high aerobic strain through short repeated efforts.',
                steps: [
                    { name: 'Warm-up', durationMin: 20, target: 'Progressively from easy Zone 2 toward moderate riding; RPE 2-4' },
                    {
                        name: '30-second work',
                        durationSec: 30,
                        repeat: 30,
                        target: 'Approximately 320-350 W, RPE rising from about 7.5 toward 8.5-9 across the session',
                        notes: 'Each work repetition is followed by 15 s at approximately 150-180 W. Organize as 3 sets of 10 repetitions with 4 min easy riding between sets.',
                    },
                    { name: 'Cooldown', durationMin: 10, target: 'Easy riding below approximately 160 W, RPE 1-2' },
                ],
            },
        };

        const json = exportExternalSessionToJson(session);
        expect(json.blocks[0].steps).toHaveLength(3);
        const workStep = json.blocks[0].steps[1];
        expect(workStep.durationSeconds).toBe(30);
        expect(workStep.restAfterSec).toBe(15);
        expect(workStep.sets).toBe(3);
        expect(workStep.repetitions).toBe(10);
        expect(workStep.setRecoverySec).toBe(240);
        expect(workStep.recoveryTarget).toBe('150-180 W');
    });

    it('preserves explicit sets and repetitions when notes describe a future progression', () => {
        const session: ExternalPlanSession = {
            id: 'w1-threshold',
            title: 'Threshold development',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: {
                summary: 'Complete the prescribed work without adding volume.',
                steps: [
                    {
                        name: 'Threshold repetitions',
                        durationMin: 3,
                        repeat: 8,
                        sets: 2,
                        recoveryMin: 2,
                        setRecoveryMin: 5,
                        target: '95% FTP',
                        notes: 'Progress toward 3 sets of 10 in a later training block.',
                    },
                ],
            },
        };

        const json = exportExternalSessionToJson(session);
        expect(json.blocks[0].steps[0].sets).toBe(2);
        expect(json.blocks[0].steps[0].repetitions).toBe(8);
    });
});
