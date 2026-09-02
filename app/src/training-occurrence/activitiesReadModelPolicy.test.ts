import { describe, expect, it } from 'vitest';
import { resolveConfiguredActivitiesReadModelPolicy } from './activitiesReadModelPolicy';

describe('resolveConfiguredActivitiesReadModelPolicy', () => {
    it('enables canonical-v1 only for the exact value', () => {
        expect(resolveConfiguredActivitiesReadModelPolicy('canonical-v1')).toBe('canonical-v1');
    });

    it('fails closed to off for missing, invalid, or unauthorized-future values', () => {
        expect(resolveConfiguredActivitiesReadModelPolicy(undefined)).toBe('off');
        expect(resolveConfiguredActivitiesReadModelPolicy(null)).toBe('off');
        expect(resolveConfiguredActivitiesReadModelPolicy('')).toBe('off');
        expect(resolveConfiguredActivitiesReadModelPolicy('CANONICAL-V1')).toBe('off');
        expect(resolveConfiguredActivitiesReadModelPolicy('canonical-v2')).toBe('off');
        expect(resolveConfiguredActivitiesReadModelPolicy('on')).toBe('off');
    });
});
