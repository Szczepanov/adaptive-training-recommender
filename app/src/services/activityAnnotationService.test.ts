import { beforeEach, describe, expect, it, vi } from 'vitest';
const firestore = vi.hoisted(() => ({ collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: () => ({}) }));
import { activityAnnotationService as service } from './activityAnnotationService';
const lap = { lapIndex: 1, averagePowerWatts: 220, rpe: 6.5, source: 'manual' };
const activity = { rpe: 6.5, equipmentLabel: 'Road bike', source: 'manual' };
const laps = (value: unknown, id = '1') => ({ docs: [{ id, data: () => value }] });

describe('activityAnnotationService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        firestore.doc.mockImplementation((_db, ...segments) => segments.join('/'));
        firestore.collection.mockImplementation((_db, ...segments) => segments.join('/'));
    });
    it('reads lap annotations without exposing storage indices', async () => {
        firestore.getDocs.mockResolvedValue(laps(lap));
        await expect(service.getLapAnnotations('owner', 'ride')).resolves.toEqual({ '1': { averagePowerWatts: 220, rpe: 6.5, source: 'manual' } });
        expect(firestore.getDocs).toHaveBeenCalledWith('users/owner/activity_annotations/ride/laps');
    });
    it('distinguishes absent activity from explicit empty annotation', async () => {
        firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
        await expect(service.getActivityAnnotation('owner', 'ride')).resolves.toBeNull();
        firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ rpe: null, equipmentLabel: null, source: 'manual' }) });
        await expect(service.getActivityAnnotation('owner', 'ride')).resolves.toEqual({ rpe: null, equipmentLabel: null, source: 'manual' });
        firestore.getDocs.mockResolvedValue({ docs: [] });
        await expect(service.getLapAnnotations('owner', 'ride')).resolves.toEqual({});
    });
    it.each([
        null, {}, { ...lap, extra: true }, { ...lap, source: 'garmin' },
        { ...lap, lapIndex: -1 }, { ...lap, lapIndex: 1.5 }, { ...lap, lapIndex: 2 },
        { ...lap, averagePowerWatts: -1 }, { ...lap, averagePowerWatts: 10001 },
        { ...lap, averagePowerWatts: NaN }, { ...lap, averagePowerWatts: Infinity },
        { ...lap, averagePowerWatts: '220' }, { ...lap, rpe: 0 }, { ...lap, rpe: 11 },
        { ...lap, rpe: NaN }, { ...lap, rpe: Infinity }, { ...lap, rpe: '6' },
        { ...lap, averagePowerWatts: null, rpe: null },
    ])('rejects malformed lap reads %#', async value => {
        firestore.getDocs.mockResolvedValue(laps(value));
        await expect(service.getLapAnnotations('owner', 'ride')).rejects.toThrow();
    });
    it.each([
        {}, null, { ...activity, extra: true }, { ...activity, source: 'garmin' },
        { ...activity, rpe: 0 }, { ...activity, rpe: 11 }, { ...activity, rpe: NaN },
        { ...activity, equipmentLabel: '' }, { ...activity, equipmentLabel: ' padded ' },
        { ...activity, equipmentLabel: 'x'.repeat(101) }, { ...activity, equipmentLabel: 1 },
    ])('rejects malformed activity reads %#', async value => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => value });
        await expect(service.getActivityAnnotation('owner', 'ride')).rejects.toThrow();
    });
    it.each([
        { averagePowerWatts: 0, rpe: null }, { averagePowerWatts: 10000, rpe: 10 },
        { averagePowerWatts: null, rpe: 1 }, { averagePowerWatts: 220.5, rpe: 6.5 },
    ])('saves power and/or effort independently %#', async value => {
        await service.saveLapAnnotation('owner', 'ride', 0, value);
        expect(firestore.setDoc).toHaveBeenCalledWith('users/owner/activity_annotations/ride/laps/0', { lapIndex: 0, ...value, source: 'manual' });
    });
    it('deletes only fully empty lap annotations', async () => {
        await service.saveLapAnnotation('owner', 'ride', 1, { averagePowerWatts: null, rpe: null });
        expect(firestore.deleteDoc).toHaveBeenCalledWith('users/owner/activity_annotations/ride/laps/1');
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });
    it.each(['  Road bike  ', '   ', null])('normalizes equipment labels %s', async label => {
        await service.saveActivityAnnotation('owner', 'ride', { rpe: null, equipmentLabel: label });
        expect(firestore.setDoc).toHaveBeenCalledWith('users/owner/activity_annotations/ride', { rpe: null, equipmentLabel: label?.trim() || null, source: 'manual' });
        expect(firestore.deleteDoc).not.toHaveBeenCalled();
    });
    it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid lap indices %s', async lapIndex => {
        await expect(service.saveLapAnnotation('owner', 'ride', lapIndex, { averagePowerWatts: 200, rpe: null })).rejects.toThrow();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });
    it.each([-1, 10001, NaN, Infinity])('rejects invalid powers %s', async averagePowerWatts => {
        await expect(service.saveLapAnnotation('owner', 'ride', 1, { averagePowerWatts, rpe: null })).rejects.toThrow();
    });
    it.each([0, 11, NaN, Infinity])('rejects invalid effort %s in both levels', async rpe => {
        await expect(service.saveLapAnnotation('owner', 'ride', 1, { averagePowerWatts: null, rpe })).rejects.toThrow();
        await expect(service.saveActivityAnnotation('owner', 'ride', { equipmentLabel: null, rpe })).rejects.toThrow();
    });
    it('rejects oversized equipment labels', async () => {
        await expect(service.saveActivityAnnotation('owner', 'ride', { rpe: null, equipmentLabel: 'x'.repeat(101) })).rejects.toThrow();
    });
    it.each(['', 'nested/id', '.', '..'])('validates identifiers before Firebase access %s', async id => {
        await expect(service.getLapAnnotations(id, 'ride')).rejects.toThrow();
        await expect(service.getActivityAnnotation('owner', id)).rejects.toThrow();
        await expect(service.saveActivityAnnotation(id, 'ride', { rpe: null, equipmentLabel: null })).rejects.toThrow();
        await expect(service.saveLapAnnotation('owner', id, 1, { averagePowerWatts: null, rpe: null })).rejects.toThrow();
        expect(firestore.doc).not.toHaveBeenCalled();
        expect(firestore.collection).not.toHaveBeenCalled();
    });
    it('propagates read/write/delete failures', async () => {
        for (const fn of [firestore.getDoc, firestore.getDocs, firestore.setDoc, firestore.deleteDoc]) fn.mockRejectedValue(new Error('denied'));
        await expect(service.getActivityAnnotation('owner', 'ride')).rejects.toThrow('denied');
        await expect(service.getLapAnnotations('owner', 'ride')).rejects.toThrow('denied');
        await expect(service.saveActivityAnnotation('owner', 'ride', { rpe: null, equipmentLabel: null })).rejects.toThrow('denied');
        await expect(service.saveLapAnnotation('owner', 'ride', 1, { averagePowerWatts: 200, rpe: null })).rejects.toThrow('denied');
        await expect(service.saveLapAnnotation('owner', 'ride', 1, { averagePowerWatts: null, rpe: null })).rejects.toThrow('denied');
    });
});
