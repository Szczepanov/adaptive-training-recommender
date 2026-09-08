import { describe, expect, it } from 'vitest';
import { resolveOccupationalLoadContext } from './occupationalLoad';

const work = { performed: true as const, duration: 'extended' as const, intensity: 'hard' as const, loadAreas: ['legs_carrying' as const] };

describe('occupational load context', () => {
    it('preserves legacy acute behavior when no baseline exists', () => {
        const result = resolveOccupationalLoadContext(work, undefined, 8000, 6000);
        expect(result.baselineApplied).toBe(false);
        expect(result.acuteDeviation).toBeCloseTo(0.875);
        expect(result.contributingSources).toEqual(['physical_work']);
    });

    it('preserves the legacy moderate/medium fallback when optional work detail is omitted', () => {
        const result = resolveOccupationalLoadContext({ performed: true }, undefined, 6000, 6000);
        expect(result.rawStrain).toBeCloseTo(0.45);
        expect(result.acuteDeviation).toBeCloseTo(0.45);
    });

    it('treats a high-confidence usual workday as adapted and exposes only an acute spike', () => {
        const baseline = { typicalDuration: 'medium' as const, typicalIntensity: 'moderate' as const, typicalLoadAreas: ['legs_carrying' as const], source: 'user_authored' as const, confidence: 1 };
        const result = resolveOccupationalLoadContext(work, baseline, 8000, 6000);
        expect(result.baselineApplied).toBe(true);
        expect(result.baselineDiscount).toBeCloseTo(0.45);
        expect(result.loadAreaOverlap).toBe(1);
        expect(result.acuteDeviation).toBeCloseTo(0.425);
        expect(result.physicalWorkAndAmbientStepSurge).toBe(false);
    });

    it('scales the adapted discount by baseline confidence', () => {
        const baseline = { typicalDuration: 'extended' as const, typicalIntensity: 'hard' as const, typicalLoadAreas: ['legs_carrying' as const], source: 'history_inferred' as const, confidence: 0.5 };
        const result = resolveOccupationalLoadContext(work, baseline, 8000, 6000);
        expect(result.baselineDiscount).toBeCloseTo(result.rawStrain * 0.5);
        expect(result.acuteDeviation).toBeCloseTo(result.rawStrain * 0.5);
    });

    it('does not erase novel tissue loading merely because duration and intensity match the usual job', () => {
        const baseline = { typicalDuration: 'extended' as const, typicalIntensity: 'hard' as const, typicalLoadAreas: ['upper_body' as const], source: 'user_authored' as const, confidence: 1 };
        const result = resolveOccupationalLoadContext(work, baseline, 8000, 6000);
        expect(result.loadAreaOverlap).toBe(0);
        expect(result.baselineApplied).toBe(false);
        expect(result.acuteDeviation).toBeCloseTo(result.rawStrain);
    });

    it('partially discounts mixed usual and novel load areas', () => {
        const mixedWork = { ...work, loadAreas: ['legs_carrying' as const, 'upper_body' as const] };
        const baseline = { typicalDuration: 'extended' as const, typicalIntensity: 'hard' as const, typicalLoadAreas: ['legs_carrying' as const], source: 'user_authored' as const, confidence: 1 };
        const result = resolveOccupationalLoadContext(mixedWork, baseline, 8000, 6000);
        expect(result.loadAreaOverlap).toBe(0.5);
        expect(result.baselineDiscount).toBeCloseTo(result.rawStrain * 0.5);
    });

    it('marks work plus a genuine ambient step surge without adding a second charge', () => {
        const result = resolveOccupationalLoadContext(work, undefined, 20000, 8000);
        expect(result.physicalWorkAndAmbientStepSurge).toBe(true);
        expect(result.contributingSources).toEqual(['physical_work', 'ambient_steps']);
    });

    it('does not mark an overlap when structured-activity deduction leaves ordinary ambient steps', () => {
        // The caller passes ambient rather than raw total steps. A 20k total day containing
        // ~12k logged running steps therefore arrives here as ~8k ambient steps.
        const result = resolveOccupationalLoadContext(work, undefined, 8000, 8000);
        expect(result.physicalWorkAndAmbientStepSurge).toBe(false);
        expect(result.contributingSources).toEqual(['physical_work']);
    });
});
