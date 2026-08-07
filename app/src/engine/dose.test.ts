import { describe, expect, it } from 'vitest';
import { resolveExecutionDose } from './dose';
import type { PlanEnvelope } from './models';

function envelope(maxAllowableTier: PlanEnvelope['maxAllowableTier']): PlanEnvelope {
    return { maxAllowableTier, taperActive: false, reason: null };
}

describe('resolveExecutionDose', () => {
    it('keeps the planned dose when there is no adjustment and the safety ceiling permits it', () => {
        expect(resolveExecutionDose(0.7, envelope('Hard'), null)).toBe(0.7);
    });

    it('moves dose down for an easier request and up for a harder request', () => {
        expect(resolveExecutionDose(0.6, envelope('Hard'), 'easier')).toBeCloseTo(0.45);
        expect(resolveExecutionDose(0.6, envelope('Hard'), 'harder')).toBeCloseTo(0.75);
    });

    it('intersects every request with the clinical/readiness ceiling', () => {
        expect(resolveExecutionDose(0.9, envelope('Easy'), null)).toBe(0.5);
        expect(resolveExecutionDose(0.9, envelope('Easy'), 'harder')).toBe(0.5);
        expect(resolveExecutionDose(0.4, envelope('Easy'), 'harder')).toBe(0.5);
        expect(resolveExecutionDose(0.4, envelope('Easy'), 'easier')).toBeCloseTo(0.25);
        expect(resolveExecutionDose(0.9, envelope('Rest'), 'easier')).toBe(0);
    });

    it('normalizes invalid plan inputs to the supported 0..1 range', () => {
        expect(resolveExecutionDose(-1, envelope('Hard'), null)).toBe(0);
        expect(resolveExecutionDose(2, envelope('Hard'), null)).toBe(1);
    });
});
