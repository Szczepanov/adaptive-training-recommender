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
});
