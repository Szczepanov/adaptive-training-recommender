import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnthropometryEntry } from '../anthropometry/models';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    setDoc: vi.fn(),
    where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { AnthropometryDataValidationError, AnthropometryService } from './anthropometryService';

function sampleEntry(): AnthropometryEntry {
    return {
        id: 'entry-1',
        userId: 'u1',
        date: '2026-09-14',
        observedAt: '2026-09-14T06:00:00.000Z',
        protocol: 'home_anthropometry@1',
        context: {
            morningPostVoidPreIntake: true,
            trainingBeforeMeasurement: false,
        },
        measurements: [
            { metricId: 'waist_minimum_cm', unit: 'cm', readings: [82.0, 82.4], value: 82.2 },
        ],
        schemaVersion: 1,
        revision: 1,
        createdAt: '2026-09-14T06:00:00.000Z',
        updatedAt: '2026-09-14T06:00:00.000Z',
    };
}

describe('AnthropometryService', () => {
    let service: AnthropometryService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AnthropometryService();
        firestore.collection.mockReturnValue({ path: 'users/u1/anthropometry_entries' });
        firestore.doc.mockReturnValue({ path: 'users/u1/anthropometry_entries/entry-1' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.deleteDoc.mockResolvedValue(undefined);
    });

    it('creates a valid entry with revision 1', async () => {
        const entry = sampleEntry();
        const created = await service.createEntry('u1', entry);
        expect(created.id).toBe('entry-1');
        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    it('rejects createEntry when revision != 1', async () => {
        const entry = { ...sampleEntry(), revision: 2 };
        await expect(service.createEntry('u1', entry)).rejects.toThrow('Initial entry revision must be 1');
    });

    it('corrects an existing entry by advancing revision', async () => {
        const existing = sampleEntry();
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => existing,
        });

        const correction = {
            ...existing,
            revision: 2,
            measurements: [
                { metricId: 'waist_minimum_cm' as const, unit: 'cm' as const, readings: [81.8, 82.2], value: 82.0 },
            ],
        };

        const result = await service.correctEntry('u1', correction);
        expect(result.revision).toBe(2);
        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    it('rejects correction with stale or skipping revision', async () => {
        const existing = sampleEntry();
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => existing,
        });

        const stale = { ...existing, revision: 1 };
        await expect(service.correctEntry('u1', stale)).rejects.toThrow('Revision conflict');

        const jumping = { ...existing, revision: 3 };
        await expect(service.correctEntry('u1', jumping)).rejects.toThrow('Revision conflict');
    });

    it('returns null only for an actually missing entry', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        await expect(service.getEntry('u1', 'entry-1')).resolves.toBeNull();
    });

    it('surfaces malformed persisted entries explicitly without echoing raw biometric values', async () => {
        const malformed = sampleEntry();
        malformed.measurements[0] = {
            metricId: 'waist_minimum_cm',
            unit: 'cm',
            readings: [39.123, 39.456],
            value: 39.2895,
        };
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => malformed,
        });

        try {
            await service.getEntry('u1', 'entry-1');
            throw new Error('Expected invalid persisted anthropometry to reject');
        } catch (error) {
            expect(error).toBeInstanceOf(AnthropometryDataValidationError);
            const message = (error as Error).message;
            expect(message).toContain('measurements[0]');
            expect(message).not.toContain('39.123');
            expect(message).not.toContain('39.456');
            expect(message).not.toContain('39.2895');
        }
    });

    it('fetches entries in a bounded range with deterministic ordering', async () => {
        const e1 = sampleEntry();
        firestore.getDocs.mockResolvedValue({
            docs: [{ id: 'entry-1', data: () => e1 }],
        });

        const results = await service.getEntriesInRange('u1', '2026-09-01', '2026-09-14');
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('entry-1');
        expect(firestore.query).toHaveBeenCalledTimes(1);
    });

    it('fails the range read instead of silently dropping a malformed row', async () => {
        const invalid = sampleEntry();
        invalid.measurements[0].value = 90.0;
        firestore.getDocs.mockResolvedValue({
            docs: [{ id: 'entry-corrupt', data: () => invalid }],
        });

        await expect(service.getEntriesInRange('u1', '2026-09-01', '2026-09-14'))
            .rejects.toBeInstanceOf(AnthropometryDataValidationError);
    });

    it('deletes an entry', async () => {
        await service.deleteEntry('u1', 'entry-1');
        expect(firestore.deleteDoc).toHaveBeenCalledTimes(1);
    });
});
