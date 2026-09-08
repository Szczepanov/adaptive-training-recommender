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

    it('treats a usual workday as adapted and exposes an acute spike', () => {
        const baseline = { typicalDuration: 'medium' as const, typicalIntensity: 'moderate' as const, typicalLoadAreas: ['legs_carrying' as const], source: 'user_authored' as const, confidence: 1 };
        const result = resolveOccupationalLoadContext(work, baseline, 8000, 6000);
        expect(result.baselineApplied).toBe(true);
        expect(result.acuteDeviation).toBeGreaterThan(0);
        expect(result.physicalWorkAndAmbientStepSurge).toBe(false);
    });

    it('marks work plus a genuine ambient step surge without adding a second charge', () => {
        const result = resolveOccupationalLoadContext(work, undefined, 20000, 8000);
        expect(result.physicalWorkAndAmbientStepSurge).toBe(true);
        expect(result.contributingSources).toEqual(['physical_work', 'ambient_steps']);
    });
});
