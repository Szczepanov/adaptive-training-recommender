import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateScheduleOverlay } from '../engine/validation';

const firestore = vi.hoisted(() => ({
    addDoc: vi.fn(), collection: vi.fn(), deleteDoc: vi.fn(), doc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { ScheduleOverlayService } from './scheduleOverlayService';

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

    // Issue #1202: the Firestore rules no longer check overlay values; this validator, run by
    // ScheduleOverlayService before every write, is their only write-time owner.
    it.each([
        ['an unknown sport', { sport: 'curling' }, 'sport'],
        ['a calendar-impossible date', { startDate: '2026-02-30' }, 'dates'],
        ['availability minutes above 1440', { dailyAvailabilityMinutes: 1500 }, 'dailyAvailabilityMinutes'],
        ['a volumeScale above 1', { volumeScale: 1.5 }, 'volumeScale'],
        ['a negative intensityScale', { intensityScale: -0.1 }, 'intensityScale'],
        ['an unknown environment', { environment: 'space' }, 'environment'],
    ])('rejects %s', (_label, override, field) => {
        const result = validateScheduleOverlay({ ...validOverlay, ...override });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === field)).toBe(true);
    });
});

describe('ScheduleOverlayService write path', () => {
    const input = {
        title: 'Christmas Break',
        category: 'sedentary_rest' as const,
        startDate: '2026-12-24',
        endDate: '2026-12-26',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0,
        intensityScale: 0,
        expectedCost: { systemic: 0.1, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'schedule_overlays' });
        firestore.doc.mockReturnValue({ path: 'schedule_overlays/overlay-1' });
        firestore.addDoc.mockResolvedValue({ id: 'overlay-1' });
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('stores the validated overlay without an id field', async () => {
        const created = await new ScheduleOverlayService().create('u1', input);
        expect(created.id).toBe('overlay-1');
        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('id');
        expect(payload).toMatchObject({ userId: 'u1', category: 'sedentary_rest', dailyAvailabilityMinutes: 0 });
    });

    // Issue #1202: the rules no longer require whole minutes or check any overlay value.
    it('rejects fractional availability minutes and invalid values on create and update without writing', async () => {
        const service = new ScheduleOverlayService();
        await expect(service.create('u1', { ...input, dailyAvailabilityMinutes: 30.5 })).rejects.toThrow(/whole number of minutes/);
        await expect(service.create('u1', { ...input, category: 'holiday' as never })).rejects.toThrow(/Validation failed/);
        await expect(service.update('u1', 'overlay-1', { ...input, dailyAvailabilityMinutes: 30.5, createdAt: '2026-12-01T00:00:00.000Z' }))
            .rejects.toThrow(/whole number of minutes/);
        await expect(service.update('u1', 'overlay-1', { ...input, endDate: '2026-12-01', createdAt: '2026-12-01T00:00:00.000Z' }))
            .rejects.toThrow(/Validation failed/);
        expect(firestore.addDoc).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('replaces the whole document on update rather than merging', async () => {
        await new ScheduleOverlayService().update('u1', 'overlay-1', { ...input, createdAt: '2026-12-01T00:00:00.000Z' });
        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        expect(firestore.setDoc.mock.calls[0]).toHaveLength(2);
    });
});
