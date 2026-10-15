import { describe, expect, it } from 'vitest';
import type { SessionEntry } from './models';
import { buildSetCorrection, isLoggedSetUndoOpen, LOGGED_SET_UNDO_WINDOW_MS } from './setCorrection';

const at = '2026-10-05T08:00:00.000Z';
const gauged: SessionEntry = {
    id: 'set-1', executionId: 'exec-1', stepId: 'squat', completedAt: at, createdAt: at, updatedAt: at,
    payload: { kind: 'repetition', setIndex: 2, reps: 5, weightKg: 100, isWarmup: false, gauge: { scale: 'rir', value: 2 } as never },
};

describe('buildSetCorrection', () => {
    it('changes only reps and load, preserving set index, warm-up flag and the tagged gauge', () => {
        const result = buildSetCorrection(gauged, { reps: '8', weightKg: '82.5' });
        expect(result).toEqual({ ok: true, payload: { ...gauged.payload, reps: 8, weightKg: 82.5 } });
    });

    it('removes the load when the field is cleared instead of keeping the stale value', () => {
        const result = buildSetCorrection(gauged, { reps: '5', weightKg: '  ' });
        expect(result.ok && 'weightKg' in result.payload).toBe(false);
        expect(result.ok && result.payload.gauge).toEqual({ scale: 'rir', value: 2 });
    });

    it.each(['', '0', '-3', '2.5', 'abc'])('rejects invalid reps %j without coercing it', reps => {
        expect(buildSetCorrection(gauged, { reps, weightKg: '10' }).ok).toBe(false);
    });

    it.each(['-1', 'NaN', 'Infinity', 'x'])('rejects invalid load %j', weightKg => {
        expect(buildSetCorrection(gauged, { reps: '5', weightKg }).ok).toBe(false);
    });

    it('accepts a large but valid value unchanged (no silent outlier correction)', () => {
        expect(buildSetCorrection(gauged, { reps: '500', weightKg: '900' })).toMatchObject({ ok: true, payload: { reps: 500, weightKg: 900 } });
    });

    it('does not mutate the source entry', () => {
        const snapshot = JSON.stringify(gauged);
        buildSetCorrection(gauged, { reps: '9', weightKg: '' });
        expect(JSON.stringify(gauged)).toBe(snapshot);
    });

    it('refuses non-repetition entries', () => {
        const hold: SessionEntry = { ...gauged, payload: { kind: 'duration', seconds: 30 } };
        expect(buildSetCorrection(hold, { reps: '5', weightKg: '' }).ok).toBe(false);
    });
});

describe('isLoggedSetUndoOpen', () => {
    it('is open inside the window and closed at and after its end or for a future timestamp', () => {
        expect(isLoggedSetUndoOpen(1_000, 1_000)).toBe(true);
        expect(isLoggedSetUndoOpen(1_000, 1_000 + LOGGED_SET_UNDO_WINDOW_MS - 1)).toBe(true);
        expect(isLoggedSetUndoOpen(1_000, 1_000 + LOGGED_SET_UNDO_WINDOW_MS)).toBe(false);
        expect(isLoggedSetUndoOpen(2_000, 1_000)).toBe(false);
    });
});
