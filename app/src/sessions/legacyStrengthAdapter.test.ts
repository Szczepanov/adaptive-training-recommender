import { describe, expect, it } from 'vitest';
import type { StrengthSession } from '../engine/models';
import { adaptStrengthSessionToNormalizedExecution } from './legacyStrengthAdapter';

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
});
