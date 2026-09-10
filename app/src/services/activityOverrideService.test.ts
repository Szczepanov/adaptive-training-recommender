import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityOverride } from '../engine/models';

const firestoreMock = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

import { ActivityOverrideService, activityOverrideService } from './activityOverrideService';

const mockOverride: ActivityOverride = {
    activityId: 'act-123',
    userId: 'user-456',
    date: '2026-03-30',
    originalType: 'Running',
    originalIntensityTag: 'hard',
    overriddenModality: 'Running',
    overriddenIntensity: 'moderate',
    rpe: 7,
    notes: 'Feeling slightly fatigued',
    createdAt: '2026-03-30T10:00:00Z',
    updatedAt: '2026-03-30T10:00:00Z',
};

describe('ActivityOverrideService', () => {
    let service: ActivityOverrideService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ActivityOverrideService();
        firestoreMock.doc.mockImplementation((_db, ...pathSegments) => ({
            path: pathSegments.join('/'),
        }));
        firestoreMock.collection.mockImplementation((_db, ...pathSegments) => ({
            path: pathSegments.join('/'),
        }));
    });

    describe('getOverride', () => {
        it('returns override object when document exists', async () => {
            firestoreMock.getDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => mockOverride,
            });

            const result = await service.getOverride('user-456', 'act-123');

            expect(firestoreMock.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-456',
                'activity_overrides',
                'act-123'
            );
            expect(result).toEqual(mockOverride);
        });

        it('returns null when document does not exist', async () => {
            firestoreMock.getDoc.mockResolvedValueOnce({
                exists: () => false,
            });

            const result = await service.getOverride('user-456', 'non-existent');

            expect(result).toBeNull();
        });

        it('catches error, logs warning, and returns null on exception', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            firestoreMock.getDoc.mockRejectedValueOnce(new Error('Firestore connection error'));

            const result = await service.getOverride('user-456', 'act-123');

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to read activity override for act-123:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('getAllOverrides', () => {
        it('returns record map of overrides indexed by activityId', async () => {
            const secondOverride: ActivityOverride = {
                ...mockOverride,
                activityId: 'act-789',
                overriddenIntensity: 'easy',
            };

            const mockDocSnaps = [
                { data: () => mockOverride },
                { data: () => secondOverride },
                { data: () => ({ invalidData: true }) }, // missing activityId
            ];

            firestoreMock.getDocs.mockResolvedValueOnce({
                forEach: (callback: (docSnap: (typeof mockDocSnaps)[number]) => void) => {
                    mockDocSnaps.forEach(callback);
                },
            });

            const result = await service.getAllOverrides('user-456');

            expect(firestoreMock.collection).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-456',
                'activity_overrides'
            );
            expect(result).toEqual({
                'act-123': mockOverride,
                'act-789': secondOverride,
            });
        });

        it('catches error, logs warning, and returns empty record on exception', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            firestoreMock.getDocs.mockRejectedValueOnce(new Error('Permission denied'));

            const result = await service.getAllOverrides('user-456');

            expect(result).toEqual({});
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to read all activity overrides:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('saveOverride', () => {
        it('saves override via setDoc and returns true', async () => {
            firestoreMock.setDoc.mockResolvedValueOnce(undefined);

            const result = await service.saveOverride('user-456', mockOverride);

            expect(firestoreMock.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-456',
                'activity_overrides',
                'act-123'
            );
            expect(firestoreMock.setDoc).toHaveBeenCalledWith(
                { path: 'users/user-456/activity_overrides/act-123' },
                mockOverride
            );
            expect(result).toBe(true);
        });

        it('catches error, logs error, and returns false on exception', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            firestoreMock.setDoc.mockRejectedValueOnce(new Error('Write failed'));

            const result = await service.saveOverride('user-456', mockOverride);

            expect(result).toBe(false);
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to save activity override for act-123:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('deleteOverride', () => {
        it('deletes override via deleteDoc and returns true', async () => {
            firestoreMock.deleteDoc.mockResolvedValueOnce(undefined);

            const result = await service.deleteOverride('user-456', 'act-123');

            expect(firestoreMock.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-456',
                'activity_overrides',
                'act-123'
            );
            expect(firestoreMock.deleteDoc).toHaveBeenCalledWith({
                path: 'users/user-456/activity_overrides/act-123',
            });
            expect(result).toBe(true);
        });

        it('catches error, logs error, and returns false on exception', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            firestoreMock.deleteDoc.mockRejectedValueOnce(new Error('Delete failed'));

            const result = await service.deleteOverride('user-456', 'act-123');

            expect(result).toBe(false);
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to delete activity override for act-123:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('activityOverrideService singleton', () => {
        it('is an instance of ActivityOverrideService', () => {
            expect(activityOverrideService).toBeInstanceOf(ActivityOverrideService);
        });
    });
});
