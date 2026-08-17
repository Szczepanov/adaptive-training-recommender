import { describe, expect, it } from 'vitest';
import { exportWorkoutPrescriptionToJson, exportExternalSessionToJson } from './workoutJsonExport';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';

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
});
