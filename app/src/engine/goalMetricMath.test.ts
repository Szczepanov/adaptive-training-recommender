import { describe, expect, it } from 'vitest';
import { computeRequiredChange, improvementSignForDirection } from './goalMetricMath';

describe('goal metric math (PG4.5.3 shared sign convention)', () => {
    it('signs higher-is-better and lower-is-better consistently', () => {
        expect(improvementSignForDirection('higher_is_better')).toBe(1);
        expect(improvementSignForDirection('lower_is_better')).toBe(-1);
        expect(improvementSignForDirection('target_range')).toBeNull();
        expect(improvementSignForDirection('context_only')).toBeNull();
    });

    it('computes a positive absolute change when improvement is still required (strength)', () => {
        const result = computeRequiredChange('higher_is_better', 200, 100);
        expect(result).toMatchObject({ absolute: 100, relativePct: 100, alreadyAchieved: false });
    });

    it('computes a positive absolute change when improvement is still required (sprint time)', () => {
        const result = computeRequiredChange('lower_is_better', 1.75, 1.86);
        expect(result?.absolute).toBeCloseTo(0.11, 5);
        expect(result?.alreadyAchieved).toBe(false);
    });

    it('flags already_achieved when the current result is at or beyond the target', () => {
        expect(computeRequiredChange('higher_is_better', 200, 200)?.alreadyAchieved).toBe(true);
        expect(computeRequiredChange('higher_is_better', 200, 220)?.alreadyAchieved).toBe(true);
        expect(computeRequiredChange('lower_is_better', 1.75, 1.70)?.alreadyAchieved).toBe(true);
    });

    it('returns null relativePct rather than Infinity/NaN when current value is zero', () => {
        const result = computeRequiredChange('higher_is_better', 50, 0);
        expect(result?.absolute).toBe(50);
        expect(result?.relativePct).toBeNull();
    });

    it('refuses non-target-eligible directions', () => {
        expect(computeRequiredChange('target_range', 50, 40)).toBeNull();
        expect(computeRequiredChange('context_only', 50, 40)).toBeNull();
    });
});
