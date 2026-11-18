import { describe, expect, it } from 'vitest';
import { buildDistancePayload, buildHoldPayload } from './setPayloads';

describe('buildHoldPayload', () => {
    it('logs the hold with its RPE', () => {
        expect(buildHoldPayload({ seconds: '30', loadKg: '', rpe: '7.5' }))
            .toEqual({ kind: 'duration', seconds: 30, gauge: { scale: 'rpe_rts', value: 7.5 } });
    });

    it('omits a blank or out-of-range RPE and keeps an extra load', () => {
        expect(buildHoldPayload({ seconds: '30', loadKg: '10', rpe: '' })).toEqual({ kind: 'duration', seconds: 30, loadKg: 10 });
        expect(buildHoldPayload({ seconds: '30', loadKg: '', rpe: '12' })).toEqual({ kind: 'duration', seconds: 30 });
    });

    it.each(['', '0', 'x'])('rejects hold seconds %j', seconds => {
        expect(buildHoldPayload({ seconds, loadKg: '', rpe: '' })).toBeNull();
    });
});

describe('buildDistancePayload', () => {
    it('logs a carry with load, time and RPE', () => {
        expect(buildDistancePayload({ meters: '40', seconds: '35', loadKg: '24', rpe: '8' }, true)).toEqual({
            kind: 'distance', meters: 40, durationSeconds: 35, loadKg: 24, gauge: { scale: 'rpe_rts', value: 8 },
        });
    });

    it('ignores a load for steps that take none', () => {
        expect(buildDistancePayload({ meters: '15', seconds: '', loadKg: '24', rpe: '' }, false)).toEqual({ kind: 'distance', meters: 15 });
    });

    it('rejects a missing distance or a negative load', () => {
        expect(buildDistancePayload({ meters: '', seconds: '', loadKg: '', rpe: '' }, true)).toBeNull();
        expect(buildDistancePayload({ meters: '40', seconds: '', loadKg: '-1', rpe: '' }, true)).toBeNull();
    });
});
