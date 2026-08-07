import { describe, it, expect } from 'vitest';
import { validateRecommendation, validateAdherenceUpdate } from './validation';

describe('validateRecommendation', () => {
    it('accepts a complete recommendation and defaults adherence to unanswered', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'str_upper_01', templateTitle: 'Upper Body Push/Pull',
            category: 'Upper-body Strength', modality: 'Strength', mode: 'modify', rationale: 'test rationale',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.adherence).toEqual({
            respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null,
        });
    });

    it('rejects a payload missing required fields', () => {
        const result = validateRecommendation({ userId: 'u1', date: '2026-08-07' });
        expect(result.isValid).toBe(false);
        expect(result.errors.map(e => e.field)).toEqual(
            expect.arrayContaining(['templateId', 'templateTitle', 'category', 'modality', 'mode', 'rationale'])
        );
    });

    it('rejects an invalid mode', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 't', templateTitle: 't', category: 'c', modality: 'm',
            mode: 'not-a-real-mode', rationale: 'r',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'mode')).toBe(true);
    });

    it('re-saving a recommendation for the same date preserves prior adherence rather than clobbering it', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'str_upper_01', templateTitle: 'Upper Body Push/Pull',
            category: 'Upper-body Strength', modality: 'Strength', mode: 'modify', rationale: 'updated rationale',
            adherence: { respondedAt: '2026-08-08T07:00:00Z', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        });
        expect(result.data?.adherence.followed).toBe(true);
        expect(result.data?.adherence.respondedAt).toBe('2026-08-08T07:00:00Z');
    });

    it('preserves a resolved detailed prescription snapshot', () => {
        const prescription = { workoutId: 'cycling_zone2_standard_01', displayBlocks: [] };
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'end_easy_01', templateTitle: 'Zone 2 Spin',
            category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'test rationale', prescription,
        });
        expect(result.data?.prescription).toEqual(prescription);
        expect(result.data?.schemaVersion).toBe(2);
    });
});

describe('validateAdherenceUpdate', () => {
    it('accepts a simple "followed it" answer', () => {
        const result = validateAdherenceUpdate({ followed: true });
        expect(result.isValid).toBe(true);
        expect(result.data?.followed).toBe(true);
        expect(result.data?.respondedAt).not.toBeNull();
    });

    it('accepts a "did something else" answer with details', () => {
        const result = validateAdherenceUpdate({
            followed: false, skipped: false, actualModality: 'Strength', actualDurationMin: 35, notes: 'felt good',
        });
        expect(result.isValid).toBe(true);
        expect(result.data).toMatchObject({ followed: false, skipped: false, actualModality: 'Strength', actualDurationMin: 35, notes: 'felt good' });
    });

    it('rejects a negative duration', () => {
        const result = validateAdherenceUpdate({ followed: false, actualDurationMin: -5 });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'actualDurationMin')).toBe(true);
    });

    it('rejects a payload missing the required followed field', () => {
        const result = validateAdherenceUpdate({ skipped: true });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'followed')).toBe(true);
    });

    it('normalizes an empty-string actualModality to null', () => {
        const result = validateAdherenceUpdate({ followed: false, actualModality: '' });
        expect(result.isValid).toBe(true);
        expect(result.data?.actualModality).toBeNull();
    });
});
