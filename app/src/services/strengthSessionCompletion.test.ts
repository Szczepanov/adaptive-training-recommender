import { describe, expect, it, vi } from 'vitest';
import type { StrengthSession } from '../engine/models';
import { finalizeStrengthSession } from './strengthSessionCompletion';

const session: StrengthSession = {
    userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T16:00:00Z',
    updatedAt: '2026-08-17T16:00:00Z', state: 'in_progress', exercises: [], schemaVersion: 1,
};

describe('finalizeStrengthSession', () => {
    it('applies 1RM derivations before making a completed session terminal', async () => {
        const calls: string[] = [];
        const applyOneRepMaxDerivations = vi.fn(async () => { calls.push('derive'); return []; });
        const transitionState = vi.fn(async (_userId, _sessionId, next, nowIso) => {
            calls.push('transition');
            return { ...session, state: next, completedAt: nowIso, updatedAt: nowIso };
        });

        await finalizeStrengthSession('u1', session, 'completed', '2026-08-17T17:00:00Z', {
            applyOneRepMaxDerivations,
            transitionState,
        });

        expect(calls).toEqual(['derive', 'transition']);
        expect(applyOneRepMaxDerivations).toHaveBeenCalledWith(
            'u1',
            expect.objectContaining({ state: 'completed', completedAt: '2026-08-17T17:00:00Z' }),
            '2026-08-17T17:00:00Z',
        );
    });

    it('keeps the session resumable when derivation fails', async () => {
        const transitionState = vi.fn();
        await expect(finalizeStrengthSession('u1', session, 'completed', '2026-08-17T17:00:00Z', {
            applyOneRepMaxDerivations: vi.fn(async () => { throw new Error('offline'); }),
            transitionState,
        })).rejects.toThrow('offline');
        expect(transitionState).not.toHaveBeenCalled();
    });

    it('abandons without deriving a 1RM', async () => {
        const applyOneRepMaxDerivations = vi.fn();
        const transitionState = vi.fn(async () => ({ ...session, state: 'abandoned' as const }));
        await finalizeStrengthSession('u1', session, 'abandoned', '2026-08-17T17:00:00Z', {
            applyOneRepMaxDerivations,
            transitionState,
        });
        expect(applyOneRepMaxDerivations).not.toHaveBeenCalled();
    });
});
