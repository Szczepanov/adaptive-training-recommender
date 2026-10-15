import { describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from './models';
import { buildSetCorrection, commitSetCorrection, CORRECTION_NOT_SAVED_REASON, planLoggedSetUndo, runLoggedSetUndo, isLoggedSetUndoOpen, LOGGED_SET_UNDO_WINDOW_MS } from './setCorrection';

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

    it.each(['', '0', '-3', '2.5', 'abc', '1e1', '0x10', '+5', '9007199254740993'])('rejects invalid reps %j without coercing it', reps => {
        expect(buildSetCorrection(gauged, { reps, weightKg: '10' }).ok).toBe(false);
    });

    it.each(['-1', 'NaN', 'Infinity', 'x', '1e2', '--1', '1.2.3'])('rejects invalid load %j', weightKg => {
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

describe('commitSetCorrection', () => {
    const effects = (persist: () => Promise<void>) => ({ applyLocal: vi.fn(), persist: vi.fn(persist), rollbackLocal: vi.fn() });

    it('applies then persists the preserved-gauge payload and reports success', async () => {
        const e = effects(async () => undefined);
        const result = await commitSetCorrection(gauged, { reps: '7', weightKg: '90' }, e);
        expect(result.ok).toBe(true);
        expect(e.applyLocal).toHaveBeenCalledWith(expect.objectContaining({ reps: 7, weightKg: 90, gauge: { scale: 'rir', value: 2 } }));
        expect(e.persist).toHaveBeenCalledOnce();
        expect(e.rollbackLocal).not.toHaveBeenCalled();
    });

    it('rolls back and reports failure when the write is rejected, so the editor stays open', async () => {
        const e = effects(async () => { throw new Error('rules'); });
        const result = await commitSetCorrection(gauged, { reps: '7', weightKg: '' }, e);
        expect(result).toEqual({ ok: false, reason: CORRECTION_NOT_SAVED_REASON });
        expect(e.rollbackLocal).toHaveBeenCalledOnce();
    });

    it('touches neither local state nor the write path for invalid input', async () => {
        const e = effects(async () => undefined);
        expect((await commitSetCorrection(gauged, { reps: '1e1', weightKg: '' }, e)).ok).toBe(false);
        expect(e.applyLocal).not.toHaveBeenCalled();
        expect(e.persist).not.toHaveBeenCalled();
    });
});

describe('planLoggedSetUndo and runLoggedSetUndo', () => {
    const idle = { undoInFlight: false, terminalInFlight: false };

    it('undoes inside the window, dismisses after expiry, and ignores nothing-to-undo', () => {
        expect(planLoggedSetUndo({ atMs: 0 }, LOGGED_SET_UNDO_WINDOW_MS - 1, idle)).toBe('undo');
        expect(planLoggedSetUndo({ atMs: 0 }, LOGGED_SET_UNDO_WINDOW_MS, idle)).toBe('expired');
        expect(planLoggedSetUndo(null, 0, idle)).toBe('ignore');
    });

    it('ignores Undo while a terminal transition or another undo is in flight', () => {
        expect(planLoggedSetUndo({ atMs: 0 }, 1, { ...idle, terminalInFlight: true })).toBe('ignore');
        expect(planLoggedSetUndo({ atMs: 0 }, 1, { ...idle, undoInFlight: true })).toBe('ignore');
    });

    it('tombstones once for a double tap', async () => {
        const lock = { current: false };
        let release!: () => void;
        const tombstone = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const first = runLoggedSetUndo(lock, tombstone);
        const second = runLoggedSetUndo(lock, tombstone);
        release();
        await Promise.all([first, second]);
        expect(tombstone).toHaveBeenCalledOnce();
    });
});
