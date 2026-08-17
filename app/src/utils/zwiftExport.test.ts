import { describe, expect, it } from 'vitest';
import { generateZwiftFromPrescription, generateZwiftFromExternalSession } from './zwiftExport';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';

describe('zwiftExport', () => {
    it('generates valid Zwift XML from a cycling workout prescription', () => {
        const prescription: WorkoutPrescription = {
            id: 'p1',
            userId: 'user-1',
            date: '2026-08-17',
            workoutId: 'aerobic_engine_3x15',
            workoutVersion: 1,
            variantId: 'full',
            targetDurationMin: 90,
            adjustedBlocks: [],
            displayBlocks: [
                {
                    id: 'b1',
                    name: 'Warm-up',
                    role: 'warmup',
                    steps: [
                        { id: 's1', name: 'Spin up', dose: '15 min', targets: ['Zone 2 building'], cues: [] },
                    ],
                },
                {
                    id: 'b2',
                    name: 'Main Work',
                    role: 'main',
                    steps: [
                        {
                            id: 's2',
                            name: 'Threshold Intervals',
                            dose: '3 x 15 min',
                            rest: '5 min easy',
                            targets: ['90-95% FTP'],
                            structuredTargets: [{ role: 'primary', label: 'Power', metric: 'ftp_percent', valueText: '90–95% FTP' }],
                            cues: [],
                        },
                    ],
                },
                {
                    id: 'b3',
                    name: 'Cool-down',
                    role: 'cooldown',
                    steps: [
                        { id: 's3', name: 'Easy spin', dose: '10 min', targets: ['Zone 1'], cues: [] },
                    ],
                },
            ],
            rationale: [],
            adjustmentReasons: [],
            source: { recommendationEngineVersion: '1.0.0' },
            status: 'recommended',
        };

        const xml = generateZwiftFromPrescription(prescription);
        expect(xml).toContain('<workout_file>');
        expect(xml).toContain('<sportType>bike</sportType>');
        expect(xml).toContain('<Warmup Duration="900"');
        expect(xml).toContain('<Intervals Repeat="3" OnDuration="900" OffDuration="300"');
        expect(xml).toContain('<Cooldown Duration="600"');
        expect(xml).toContain('</workout_file>');
    });

    it('generates valid Zwift XML from an external plan session', () => {
        const session: ExternalPlanSession = {
            id: 'ext-s1',
            title: 'Threshold 3x12',
            priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'carry_forward' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 75, durationMax: 90, environment: 'either', equipment: [] },
            prescription: {
                summary: '3x12 at threshold.',
                steps: [
                    { name: 'Warm-up', durationMin: 15, target: 'Zone 2' },
                    { name: 'Interval', durationMin: 12, repeat: 3, recoveryMin: 4, target: '95-100% FTP' },
                    { name: 'Cool-down', durationMin: 10, target: 'Zone 1' },
                ],
            },
        };

        const xml = generateZwiftFromExternalSession(session);
        expect(xml).toContain('<workout_file>');
        expect(xml).toContain('<name>Threshold 3x12</name>');
        expect(xml).toContain('<Warmup Duration="900"');
        expect(xml).toContain('<Intervals Repeat="3" OnDuration="720" OffDuration="240"');
        expect(xml).toContain('<Cooldown Duration="600"');
    });
});
