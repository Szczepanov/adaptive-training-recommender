import { describe, expect, it } from 'vitest';
import { generateZwiftFromPrescription, generateZwiftFromExternalSession, generateZwiftFromExternalSessionV2 } from './zwiftExport';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';

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

    it('generates valid Zwift XML from a v2 external plan session using block roles instead of name-text regex (M3.6)', () => {
        const session: ExternalPlanSessionV2 = {
            id: 'ext-s1-v2',
            title: 'Threshold 3x12',
            priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'carry_forward' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 75, durationMax: 90, environment: 'either', equipment: [] },
            definition: {
                schemaVersion: 1, id: 'ext-s1-v2', revision: 1, title: 'Threshold 3x12', summary: '3x12 at threshold.', intent: 'training',
                blocks: [
                    {
                        id: 'block-warmup', role: 'warmup', executionMode: 'sequential',
                        steps: [{ id: 's1', kind: 'exercise', title: 'Warm-up', exerciseRef: { kind: 'unresolved_free_text', name: 'Warm-up' }, dose: { kind: 'duration', seconds: 900 } }],
                    },
                    {
                        id: 'block-main', role: 'main', executionMode: 'sequential',
                        steps: [{ id: 's2', kind: 'exercise', title: 'Interval', exerciseRef: { kind: 'unresolved_free_text', name: 'Interval' }, dose: { kind: 'duration', sets: 3, seconds: 720 }, rest: 240 }],
                    },
                    {
                        id: 'block-cooldown', role: 'cooldown', executionMode: 'sequential',
                        steps: [{ id: 's3', kind: 'exercise', title: 'Cool-down', exerciseRef: { kind: 'unresolved_free_text', name: 'Cool-down' }, dose: { kind: 'duration', seconds: 600 } }],
                    },
                ],
            },
        };

        const xml = generateZwiftFromExternalSessionV2(session);
        expect(xml).toContain('<workout_file>');
        expect(xml).toContain('<name>Threshold 3x12</name>');
        expect(xml).toContain('<Warmup Duration="900"');
        expect(xml).toContain('<Intervals Repeat="3" OnDuration="720" OffDuration="240"');
        expect(xml).toContain('<Cooldown Duration="600"');
    });

    it('generates multi-set intervals in Zwift XML for 30/15 sessions', () => {
        const session: ExternalPlanSession = {
            id: 'w1-vo2',
            title: 'VO2 30/15 repeated aerobic power',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: {
                summary: '3 sets of 10 x 30s/15s.',
                steps: [
                    { name: 'Warm-up', durationMin: 20, target: 'Progressively from easy Zone 2' },
                    { name: '30-second work', durationSec: 30, repeat: 30, target: '320-350 W', notes: 'Each work repetition is followed by 15 s at approximately 150-180 W. Organize as 3 sets of 10 repetitions with 4 min easy riding between sets.' },
                    { name: 'Cooldown', durationMin: 10, target: 'Easy riding below approximately 160 W' },
                ],
            },
        };

        const xml = generateZwiftFromExternalSession(session);
        expect(xml).toContain('<Warmup Duration="1200"');
        // Should have 3 intervals blocks of 10 x 30s/15s
        const intervalMatches = xml.match(/<Intervals Repeat="10" OnDuration="30" OffDuration="15"/g);
        expect(intervalMatches).toHaveLength(3);
        // Should have 2 set recoveries of 240s between sets
        const setRecoveryMatches = xml.match(/<SteadyState Duration="240" Power="0.50"\/>/g);
        expect(setRecoveryMatches).toHaveLength(2);
        expect(xml).toContain('<Cooldown Duration="600"');
    });

    it('converts absolute watts only when the athlete FTP is available', () => {
        const session: ExternalPlanSession = {
            id: 'w1-power',
            title: 'Power target',
            priority: 'key',
            placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 20, durationMax: 30, environment: 'indoor', equipment: ['indoor_bike'] },
            prescription: {
                summary: 'Ride at the prescribed absolute power.',
                steps: [{ name: 'Main effort', durationMin: 20, target: '300 W' }],
            },
        };

        const withoutFtp = generateZwiftFromExternalSession(session);
        expect(withoutFtp).toContain('<SteadyState Duration="1200" Power="0.80"/>');
        expect(withoutFtp).not.toContain('Power="1.20"');

        const withFtp = generateZwiftFromExternalSession(session, { ftpWatts: 300 });
        expect(withFtp).toContain('<SteadyState Duration="1200" Power="1.00"/>');
    });
});
