import { describe, expect, it, vi } from 'vitest';
import {
    buildIntensityGauge,
    buildRepetitionPayload,
    focusAndSelect,
    runSingleFlight,
    type RepetitionDraft,
} from './repetitionSubmit';

const draft = (overrides: Partial<RepetitionDraft> = {}): RepetitionDraft => ({
    reps: '8',
    weight: '60',
    isWarmup: false,
    gaugeScale: 'rpe',
    gaugeVal: '',
    technicalMet: true,
    technicalNote: '',
    ...overrides,
});

describe('buildRepetitionPayload', () => {
    it('builds a repetition payload with weight and no gauge when the gauge is empty', () => {
        expect(buildRepetitionPayload(draft())).toEqual({
            kind: 'repetition', setIndex: 1, reps: 8, weightKg: 60, isWarmup: false,
        });
    });

    it('omits weight for bodyweight sets', () => {
        const payload = buildRepetitionPayload(draft({ weight: '  ' }));
        expect(payload).not.toBeNull();
        expect(payload).not.toHaveProperty('weightKg');
    });

    it.each(['', 'abc', '0', '-3'])('rejects invalid reps %j', reps => {
        expect(buildRepetitionPayload(draft({ reps }))).toBeNull();
    });

    it('carries the warm-up flag and gauge', () => {
        expect(buildRepetitionPayload(draft({ isWarmup: true, gaugeVal: '7.5' }))).toMatchObject({
            isWarmup: true, gauge: { scale: 'rpe_rts', value: 7.5 },
        });
    });
});

describe('buildIntensityGauge', () => {
    it('enforces each scale range', () => {
        expect(buildIntensityGauge(draft({ gaugeScale: 'rpe', gaugeVal: '0.5' }))).toBeUndefined();
        expect(buildIntensityGauge(draft({ gaugeScale: 'rpe', gaugeVal: '11' }))).toBeUndefined();
        expect(buildIntensityGauge(draft({ gaugeScale: 'rir', gaugeVal: '0' }))).toEqual({ scale: 'rir', value: 0 });
        expect(buildIntensityGauge(draft({ gaugeScale: 'rir', gaugeVal: '10.5' }))).toBeUndefined();
        expect(buildIntensityGauge(draft({ gaugeScale: 'velocity_loss', gaugeVal: '100' }))).toEqual({ scale: 'velocity_loss', percent: 100 });
        expect(buildIntensityGauge(draft({ gaugeScale: 'velocity_loss', gaugeVal: '101' }))).toBeUndefined();
        expect(buildIntensityGauge(draft({ gaugeScale: 'none', gaugeVal: '5' }))).toBeUndefined();
    });

    it('trims the technical note and omits it when blank', () => {
        expect(buildIntensityGauge(draft({ gaugeScale: 'technical', technicalMet: false, technicalNote: ' knees in ' })))
            .toEqual({ scale: 'technical', met: false, note: 'knees in' });
        expect(buildIntensityGauge(draft({ gaugeScale: 'technical', technicalNote: '  ' })))
            .toEqual({ scale: 'technical', met: true });
    });
});

describe('runSingleFlight', () => {
    it('runs exactly one write when two submits arrive in the same tick', async () => {
        const guard = { current: false };
        let release: () => void = () => {};
        const work = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));

        const first = runSingleFlight(guard, work);
        const second = runSingleFlight(guard, work);
        expect(await second).toBe(false);
        expect(work).toHaveBeenCalledTimes(1);

        release();
        expect(await first).toBe(true);
        expect(guard.current).toBe(false);

        // Once the first write completes the next set can be logged.
        expect(await runSingleFlight(guard, async () => {})).toBe(true);
    });

    it('releases the guard when the write rejects', async () => {
        const guard = { current: false };
        await expect(runSingleFlight(guard, async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
        expect(guard.current).toBe(false);
        expect(await runSingleFlight(guard, async () => {})).toBe(true);
    });
});

describe('focusAndSelect', () => {
    it('focuses before selecting', () => {
        const calls: string[] = [];
        focusAndSelect({ focus: () => calls.push('focus'), select: () => calls.push('select') });
        expect(calls).toEqual(['focus', 'select']);
    });

    it('is a no-op without a field', () => {
        expect(() => focusAndSelect(null)).not.toThrow();
    });
});
