import { describe, expect, it, vi } from 'vitest';
import type { StrengthSession } from '../engine/models';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import { StrengthHistoryReadService } from './strengthHistoryReadService';

describe('StrengthHistoryReadService (M2.7 Shared Strength Read Boundary)', () => {
    it('merges legacy strength sessions and modern repetition executions deterministically', async () => {
        const legacySessions: StrengthSession[] = [
            {
                userId: 'u1',
                sessionId: 'leg-1',
                date: '2026-08-10',
                startedAt: '2026-08-10T10:00:00Z',
                completedAt: '2026-08-10T11:00:00Z',
                updatedAt: '2026-08-10T11:00:00Z',
                state: 'completed',
                exercises: [
                    {
                        exerciseId: 'bench_press',
                        sets: [
                            { setIndex: 1, reps: 8, weightKg: 80, isWarmup: false, completedAt: '2026-08-10T10:15:00Z' },
                        ],
                    },
                ],
                schemaVersion: 1,
            },
        ];

        const modernExecutions: NormalizedExecutionRecord[] = [
            {
                execution: {
                    userId: 'u1',
                    executionId: 'mod-1',
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-12',
                    startedAt: '2026-08-12T14:00:00Z',
                    completedAt: '2026-08-12T15:00:00Z',
                    updatedAt: '2026-08-12T15:00:00Z',
                    state: 'completed',
                    schemaVersion: 1,
                },
                entries: [
                    {
                        id: 'e1',
                        executionId: 'mod-1',
                        exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
                        completedAt: '2026-08-12T14:15:00Z',
                        createdAt: '2026-08-12T14:15:00Z',
                        updatedAt: '2026-08-12T14:15:00Z',
                        payload: {
                            kind: 'repetition',
                            setIndex: 1,
                            reps: 6,
                            weightKg: 85,
                            isWarmup: false,
                        },
                    },
                ],
            },
            {
                // Pure duration session (e.g. recovery spin), should be omitted from strength sessions
                execution: {
                    userId: 'u1',
                    executionId: 'mod-spin',
                    sessionSource: { kind: 'manual', definitionId: 'spin', revision: 1, contentHash: 'h1' },
                    date: '2026-08-11',
                    startedAt: '2026-08-11T12:00:00Z',
                    completedAt: '2026-08-11T12:30:00Z',
                    updatedAt: '2026-08-11T12:30:00Z',
                    state: 'completed',
                    schemaVersion: 1,
                },
                entries: [
                    {
                        id: 'e-spin',
                        executionId: 'mod-spin',
                        exerciseRef: { kind: 'catalog', exerciseId: 'spin_bike' },
                        completedAt: '2026-08-11T12:30:00Z',
                        createdAt: '2026-08-11T12:00:00Z',
                        updatedAt: '2026-08-11T12:30:00Z',
                        payload: {
                            kind: 'duration',
                            seconds: 1800,
                        },
                    },
                ],
            },
        ];

        const mockLegacyService = {
            getSessionsInRange: vi.fn().mockResolvedValue({
                sessions: legacySessions,
                invalidRecords: 1,
            }),
        } as unknown as typeof import('./strengthSessionService').strengthSessionService;

        const mockExecutionService = {
            getExecutionsInRange: vi.fn().mockResolvedValue({
                executions: modernExecutions,
                invalidRecords: 2,
            }),
        } as unknown as typeof import('./sessionExecutionService').sessionExecutionService;

        const service = new StrengthHistoryReadService(mockLegacyService, mockExecutionService);
        const result = await service.getSessionsInRange('u1', '2026-08-01', '2026-08-15');

        expect(result.invalidRecords).toBe(3);
        expect(result.sessions).toHaveLength(2);
        expect(result.sessions[0].sessionId).toBe('leg-1');
        expect(result.sessions[0].date).toBe('2026-08-10');
        expect(result.sessions[1].sessionId).toBe('mod-1');
        expect(result.sessions[1].date).toBe('2026-08-12');
        expect(result.sessions[1].exercises[0].exerciseId).toBe('bench_press');
        expect(result.sessions[1].exercises[0].sets[0].weightKg).toBe(85);
    });
});
