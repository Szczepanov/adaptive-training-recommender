import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StrengthSessionRunner } from './StrengthSessionRunner';
import * as runnerHook from '../hooks/useStrengthSessionRunner';
import type { UseStrengthSessionRunnerResult } from '../hooks/useStrengthSessionRunner';

function baseResult(overrides: Partial<UseStrengthSessionRunnerResult> = {}): UseStrengthSessionRunnerResult {
    return {
        loading: false,
        saving: false,
        error: null,
        session: null,
        plannedExercises: [],
        activeExerciseIndex: null,
        draft: { reps: 1, weightKg: null, isWarmup: false },
        syncStatusForSet: vi.fn(() => 'synced' as const),
        start: vi.fn(),
        selectExercise: vi.fn(),
        updateDraft: vi.fn(),
        logSet: vi.fn(),
        finishSession: vi.fn(),
        abandonSession: vi.fn(),
        ...overrides,
    };
}

describe('StrengthSessionRunner', () => {
    it('renders a start prompt with no active session', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult());
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).toContain('Start strength session');
    });

    it('renders a loading state before the resume check completes', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({ loading: true }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).toContain('Loading strength session');
    });

    it('renders planned exercises from a matched prescription', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                updatedAt: '2026-08-17T18:00:00Z', state: 'in_progress', exercises: [], schemaVersion: 1,
            },
            plannedExercises: [{ exerciseId: 'bench_press', name: 'Bench press', targetSets: 3, targetReps: 6, targetGauge: { scale: 'rir', value: 4 }, optional: false }],
        }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).toContain('Bench press');
        expect(html).toContain('3 × 6');
        expect(html).toContain('4 RIR');
    });

    it('renders logged sets for the active exercise, including gauge and warm-up labels', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                updatedAt: '2026-08-17T18:02:00Z', state: 'in_progress',
                exercises: [{ exerciseId: 'bench_press', sets: [
                    { setIndex: 1, reps: 5, weightKg: 60, isWarmup: true, completedAt: '2026-08-17T18:01:00Z' },
                    { setIndex: 2, reps: 3, weightKg: 80, isWarmup: false, completedAt: '2026-08-17T18:02:00Z', gauge: { scale: 'rir', value: 3 } },
                ] }],
                schemaVersion: 1,
            },
            activeExerciseIndex: 0,
        }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).toContain('warm-up');
        expect(html).toContain('3 RIR');
        expect(html).toContain('synced');
        expect(html).toContain('Log set');
    });

    it('labels the timer "Elapsed" before any set is logged and "Rest" once one has been', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                updatedAt: '2026-08-17T18:00:00Z', state: 'in_progress',
                exercises: [{ exerciseId: 'bench_press', sets: [] }],
                schemaVersion: 1,
            },
            activeExerciseIndex: 0,
        }));
        const htmlNoSets = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(htmlNoSets).toContain('Elapsed:');

        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                updatedAt: '2026-08-17T18:02:00Z', state: 'in_progress',
                exercises: [{ exerciseId: 'bench_press', sets: [{ setIndex: 1, reps: 5, weightKg: 60, isWarmup: false, completedAt: '2026-08-17T18:01:00Z' }] }],
                schemaVersion: 1,
            },
            activeExerciseIndex: 0,
        }));
        const htmlWithSet = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(htmlWithSet).toContain('Rest:');
    });

    it('hides the timer once the session is closed', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z', state: 'completed',
                exercises: [{ exerciseId: 'bench_press', sets: [{ setIndex: 1, reps: 5, weightKg: 60, isWarmup: false, completedAt: '2026-08-17T18:01:00Z' }] }],
                schemaVersion: 1,
            },
            activeExerciseIndex: 0,
        }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).not.toContain('strength-rest-timer');
    });

    it('hides set-entry controls and session actions once the session is completed', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({
            session: {
                userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
                completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z', state: 'completed',
                exercises: [{ exerciseId: 'bench_press', sets: [{ setIndex: 1, reps: 5, weightKg: 60, isWarmup: false, completedAt: '2026-08-17T18:01:00Z' }] }],
                schemaVersion: 1,
            },
            activeExerciseIndex: 0,
        }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).not.toContain('Log set');
        expect(html).not.toContain('Finish session');
        expect(html).toContain('completed');
    });

    it('surfaces an error from the hook without swallowing it', () => {
        vi.spyOn(runnerHook, 'useStrengthSessionRunner').mockReturnValue(baseResult({ error: 'Could not save that set' }));
        const html = renderToStaticMarkup(<StrengthSessionRunner userId="u1" />);
        expect(html).toContain('Could not save that set');
    });
});
