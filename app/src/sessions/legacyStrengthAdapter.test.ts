import { describe, expect, it } from 'vitest';
import type { StrengthSession } from '../engine/models';
import {
    adaptStrengthSessionToNormalizedExecution,
    adaptNormalizedExecutionToStrengthSession,
} from './legacyStrengthAdapter';

describe('Legacy Strength Session Adapter (M2.7 / ADR-0023)', () => {
    it('purely maps a completed v1 strength session with catalog and free-text exercises', () => {
        const legacy: StrengthSession = {
            userId: 'user-123',
            sessionId: 'sess-abc',
            date: '2026-08-18',
            startedAt: '2026-08-18T10:00:00Z',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
            state: 'completed',
            sessionRpe: 8,
            notes: 'Solid session',
            exercises: [
                {
                    exerciseId: 'bench_press',
                    sets: [
                        { setIndex: 1, reps: 8, weightKg: 80, isWarmup: false, completedAt: '2026-08-18T10:10:00Z', gauge: { scale: 'rpe_rts', value: 8 } },
                        { setIndex: 2, reps: 8, weightKg: 80, isWarmup: false, completedAt: '2026-08-18T10:15:00Z' },
                    ],
                },
                {
                    exerciseId: null,
                    freeTextName: 'Custom Band Iso',
                    sets: [
                        { setIndex: 1, reps: 1, weightKg: null, isWarmup: false, completedAt: '2026-08-18T10:25:00Z' },
                    ],
                },
            ],
            schemaVersion: 1,
        };

        const result = adaptStrengthSessionToNormalizedExecution(legacy);

        expect(result.execution).toMatchObject({
            userId: 'user-123',
            executionId: 'sess-abc',
            date: '2026-08-18',
            startedAt: '2026-08-18T10:00:00Z',
            completedAt: '2026-08-18T10:45:00Z',
            state: 'completed',
            sessionRpe: 8,
            notes: 'Solid session',
        });

        expect(result.entries).toHaveLength(3);

        expect(result.entries[0]).toMatchObject({
            id: 'sess-abc-ex0-set1',
            executionId: 'sess-abc',
            exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
            payload: {
                kind: 'repetition',
                setIndex: 1,
                reps: 8,
                weightKg: 80,
                isWarmup: false,
                gauge: { scale: 'rpe_rts', value: 8 },
            },
        });

        expect(result.entries[2]).toMatchObject({
            id: 'sess-abc-ex1-set1',
            exerciseRef: { kind: 'unresolved_free_text', name: 'Custom Band Iso' },
            payload: {
                kind: 'repetition',
                setIndex: 1,
                reps: 1,
                isWarmup: false,
            },
        });
    });

    it('roundtrips a legacy strength session through normalized execution without data loss', () => {
        const legacy: StrengthSession = {
            userId: 'user-123',
            sessionId: 'sess-roundtrip',
            date: '2026-08-18',
            startedAt: '2026-08-18T10:00:00Z',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
            state: 'completed',
            sessionRpe: 7.5,
            notes: 'Felt great',
            exercises: [
                {
                    exerciseId: 'back_squat',
                    sets: [
                        { setIndex: 1, reps: 5, weightKg: 100, isWarmup: true, completedAt: '2026-08-18T10:10:00Z' },
                        { setIndex: 2, reps: 5, weightKg: 140, isWarmup: false, completedAt: '2026-08-18T10:15:00Z', gauge: { scale: 'rir', value: 2 } },
                    ],
                },
                {
                    exerciseId: null,
                    freeTextName: 'Nordic Hamstring Curl',
                    sets: [
                        { setIndex: 1, reps: 6, weightKg: null, isWarmup: false, completedAt: '2026-08-18T10:25:00Z' },
                    ],
                },
            ],
            schemaVersion: 1,
        };

        const normalized = adaptStrengthSessionToNormalizedExecution(legacy);
        const adaptedBack = adaptNormalizedExecutionToStrengthSession(normalized);

        expect(adaptedBack).toEqual(legacy);
    });

    it('handles mixed entries by adapting only repetition entries into strength exercises', () => {
        const normalized = {
            execution: {
                userId: 'user-456',
                executionId: 'exec-mixed',
                sessionSource: { kind: 'manual' as const, definitionId: 'def-1', revision: 1, contentHash: 'abc' },
                date: '2026-08-18',
                startedAt: '2026-08-18T09:00:00Z',
                completedAt: '2026-08-18T09:40:00Z',
                updatedAt: '2026-08-18T09:40:00Z',
                state: 'completed' as const,
                schemaVersion: 1,
            },
            entries: [
                {
                    id: 'entry-1',
                    executionId: 'exec-mixed',
                    exerciseRef: { kind: 'catalog' as const, exerciseId: 'deadlift' },
                    completedAt: '2026-08-18T09:10:00Z',
                    createdAt: '2026-08-18T09:10:00Z',
                    updatedAt: '2026-08-18T09:10:00Z',
                    payload: {
                        kind: 'repetition' as const,
                        setIndex: 1,
                        reps: 5,
                        weightKg: 160,
                        isWarmup: false,
                    },
                },
                {
                    id: 'entry-2',
                    executionId: 'exec-mixed',
                    exerciseRef: { kind: 'catalog' as const, exerciseId: 'plank' },
                    completedAt: '2026-08-18T09:20:00Z',
                    createdAt: '2026-08-18T09:20:00Z',
                    updatedAt: '2026-08-18T09:20:00Z',
                    payload: {
                        kind: 'duration' as const,
                        seconds: 60,
                    },
                },
            ],
        };

        const adapted = adaptNormalizedExecutionToStrengthSession(normalized);
        expect(adapted.exercises).toHaveLength(1);
        expect(adapted.exercises[0].exerciseId).toBe('deadlift');
        expect(adapted.exercises[0].sets).toHaveLength(1);
        expect(adapted.exercises[0].sets[0].weightKg).toBe(160);
    });
});
