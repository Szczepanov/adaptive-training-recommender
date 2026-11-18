import { describe, expect, it } from 'vitest';
import type { SessionStep } from '../../../sessions/models';
import { buildRpeGauge, rpePlaceholderFor } from './rpeGauge';

describe('buildRpeGauge', () => {
    it('builds an RPE gauge for a value from 1 to 10', () => {
        expect(buildRpeGauge('7.5')).toEqual({ scale: 'rpe_rts', value: 7.5 });
    });

    it.each(['', '  ', 'x', '0', '11'])('yields no gauge for %j', raw => {
        expect(buildRpeGauge(raw)).toBeUndefined();
    });
});

describe('rpePlaceholderFor', () => {
    const step: SessionStep = { id: 's', kind: 'exercise', dose: { kind: 'distance', sets: 3, meters: 40 } };
    it('shows the prescribed RPE target when one exists', () => {
        expect(rpePlaceholderFor({ ...step, effort: { kind: 'rpe', target: { min: 7, max: 8 } } })).toBe('Target: 7-8');
        expect(rpePlaceholderFor({ ...step, effort: { rpe: 6 } })).toBe('Target: 6');
        expect(rpePlaceholderFor(step)).toBe('Optional');
    });
});
