import { describe, expect, it } from 'vitest';
import { resolveExecutionDose } from './dose';
import type { PlannedDose, PlanEnvelope } from './models';

function envelope(maxAllowableTier: PlanEnvelope['maxAllowableTier']): PlanEnvelope {
    return { maxAllowableTier, taperActive: false, reason: null };
}

function dose(volume: number, intensity = 1): PlannedDose {
    return { volume, intensity };
}

describe('resolveExecutionDose', () => {
    it('keeps the planned dose when there is no adjustment and the safety ceiling permits it', () => {
        expect(resolveExecutionDose(dose(0.7), envelope('Hard'), null)).toEqual(dose(0.7));
    });

    it('moves dose down for an easier request and up for a harder request', () => {
        expect(resolveExecutionDose(dose(0.6, 0.8), envelope('Hard'), 'easier')).toMatchObject({ volume: expect.closeTo(0.45), intensity: 0.8 });
        expect(resolveExecutionDose(dose(0.6, 0.8), envelope('Hard'), 'harder')).toMatchObject({ volume: expect.closeTo(0.75), intensity: 0.8 });
    });

    it('intersects every request with the clinical/readiness ceiling', () => {
        expect(resolveExecutionDose(dose(0.9), envelope('Easy'), null).volume).toBe(0.5);
        expect(resolveExecutionDose(dose(0.9), envelope('Easy'), 'harder').volume).toBe(0.5);
        expect(resolveExecutionDose(dose(0.4), envelope('Easy'), 'harder').volume).toBe(0.5);
        expect(resolveExecutionDose(dose(0.4), envelope('Easy'), 'easier').volume).toBeCloseTo(0.25);
        expect(resolveExecutionDose(dose(0.9), envelope('Rest'), 'easier').volume).toBe(0);
    });

    it('normalizes invalid plan inputs to the supported 0..1 range', () => {
        expect(resolveExecutionDose(dose(-1), envelope('Hard'), null).volume).toBe(0);
        expect(resolveExecutionDose(dose(2), envelope('Hard'), null).volume).toBe(1);
    });
});
