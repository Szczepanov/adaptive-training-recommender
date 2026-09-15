import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnthropometryEntry } from '../anthropometry/models';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));
const mockGetAuthInstance = vi.hoisted(() => vi.fn());
const mockGetIdToken = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({
    getAuthInstance: () => mockGetAuthInstance(),
    getDb: vi.fn(() => ({})),
}));

import {
    AnthropometryDataValidationError,
    AnthropometryService,
    AnthropometryWriteError,
} from './anthropometryService';

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
        mockGetIdToken.mockResolvedValue('firebase-id-token');
        mockGetAuthInstance.mockReturnValue({ currentUser: { uid: 'u1', getIdToken: mockGetIdToken } });
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends a validated create to the server-authoritative endpoint, never a direct Firestore write', async () => {
        const entry = sampleEntry();
        const persisted = {
            ...entry,
            measurements: [{ ...entry.measurements[0], repeatabilityWarning: false }],
        };
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ entry: persisted }), { status: 200 }));

        await expect(service.createEntry('u1', entry)).resolves.toEqual(persisted);

        expect(mockFetch).toHaveBeenCalledWith('/api/anthropometry/entries', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer firebase-id-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ entry: persisted }),
        });
    });

    it('rejects createEntry locally when revision != 1 without making a write request', async () => {
        const entry = { ...sampleEntry(), revision: 2 };
        await expect(service.createEntry('u1', entry)).rejects.toThrow('Initial entry revision must be 1');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends corrections through the revision-protected server endpoint', async () => {
        const correction = { ...sampleEntry(), revision: 2 };
        const persisted = {
            ...correction,
            measurements: [{ ...correction.measurements[0], repeatabilityWarning: false }],
        };
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ entry: persisted }), { status: 200 }));

        await expect(service.correctEntry('u1', correction)).resolves.toEqual(persisted);

        expect(mockFetch).toHaveBeenCalledWith('/api/anthropometry/entries/entry-1', {
            method: 'PUT',
            headers: {
                Authorization: 'Bearer firebase-id-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ entry: persisted }),
        });
    });

    it('preserves safe server conflict metadata without echoing measurement values', async () => {
        mockFetch.mockResolvedValue(new Response(JSON.stringify({
            error: 'This entry changed elsewhere. Refresh it before saving your correction.',
            errorCode: 'anthropometry.conflict.revision',
            retryable: false,
            requestId: 'req-123',
        }), { status: 409 }));

        await expect(service.correctEntry('u1', { ...sampleEntry(), revision: 2 })).rejects.toMatchObject({
            name: 'AnthropometryWriteError',
            code: 'anthropometry.conflict.revision',
            status: 409,
            retryable: false,
            requestId: 'req-123',
        });
    });

    it('requires the authenticated user to match the component user before any write request', async () => {
        mockGetAuthInstance.mockReturnValue({ currentUser: { uid: 'u2', getIdToken: mockGetIdToken } });

        await expect(service.createEntry('u1', sampleEntry())).rejects.toBeInstanceOf(AnthropometryWriteError);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('requires an app session before any write request', async () => {
        mockGetAuthInstance.mockReturnValue({ currentUser: null });

        await expect(service.createEntry('u1', sampleEntry())).rejects.toMatchObject({
            code: 'anthropometry.auth.no_session',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('deletes only through the authenticated server endpoint', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

        await expect(service.deleteEntry('u1', 'entry-1')).resolves.toBeUndefined();

        expect(mockFetch).toHaveBeenCalledWith('/api/anthropometry/entries/entry-1', {
            method: 'DELETE',
            headers: { Authorization: 'Bearer firebase-id-token' },
        });
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
});
