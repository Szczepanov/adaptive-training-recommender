import { describe, expect, it } from 'vitest';
import { validateScheduleOverlay } from '../engine/validation';

describe('validateScheduleOverlay', () => {
    const validOverlay = {
        userId: 'user-123',
        title: 'Christmas Break',
        category: 'sedentary_rest',
        startDate: '2026-12-24',
        endDate: '2026-12-26',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.1,
            cardiovascular: 0.0,
            lowerBody: 0.0,
            upperBody: 0.0,
            impactTissue: 0.0,
            neuromuscular: 0.0,
        },
    };

    it('passes for a valid sedentary rest overlay', () => {
        const result = validateScheduleOverlay(validOverlay);
        expect(result.isValid).toBe(true);
        expect(result.data?.category).toBe('sedentary_rest');
        expect(result.data?.dailyAvailabilityMinutes).toBe(0);
    });

    it('passes for a valid active sport overlay with sport specified', () => {
        const result = validateScheduleOverlay({
            ...validOverlay,
            title: 'Ski Vacation',
            category: 'active_sport',
            sport: 'skiing',
            expectedCost: {
                systemic: 0.7,
                cardiovascular: 0.5,
                lowerBody: 0.85,
                upperBody: 0.1,
                impactTissue: 0.4,
                neuromuscular: 0.5,
            },
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.sport).toBe('skiing');
        expect(result.data?.expectedCost.lowerBody).toBe(0.85);
    });

    it('rejects an overlay where startDate is after endDate', () => {
        const result = validateScheduleOverlay({
            ...validOverlay,
            startDate: '2026-12-27',
            endDate: '2026-12-24',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'dates')).toBe(true);
    });

    it('rejects invalid category', () => {
        const result = validateScheduleOverlay({
            ...validOverlay,
            category: 'unsupported_category',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'category')).toBe(true);
    });

    it('rejects out of bounds cost', () => {
        const result = validateScheduleOverlay({
            ...validOverlay,
            expectedCost: {
                ...validOverlay.expectedCost,
                lowerBody: 1.5, // > 1
            },
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'expectedCost.lowerBody')).toBe(true);
    });

    it('rejects negative availability minutes', () => {
        const result = validateScheduleOverlay({
            ...validOverlay,
            dailyAvailabilityMinutes: -10,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'dailyAvailabilityMinutes')).toBe(true);
    });
});
