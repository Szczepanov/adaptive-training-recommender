import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailySubjectiveCheckin } from '../engine/models';

const DELETE_FIELD_SENTINEL = Symbol('deleteField');

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        deleteDoc: vi.fn(),
        deleteField: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        limit: vi.fn(),
        orderBy: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { CheckinService } from './checkinService';

const baseCheckin: Partial<DailySubjectiveCheckin> = {
    readiness: 7,
    sleepQuality: 7,
    fatigue: 5,
    soreness: 5,
    mentalStress: 5,
    motivation: 7,
    illnessSymptoms: false,
    unusuallyLimitedTime: false,
    alreadyTrainedToday: false,
};

function storedCheckin(date: string): DailySubjectiveCheckin {
    return {
        userId: 'u1', date,
        readiness: 7, sleepQuality: 7, fatigue: 4, soreness: 3, mentalStress: 4, motivation: 7,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] }, schemaVersion: 1,
        createdAt: `${date}T06:00:00Z`, updatedAt: `${date}T06:00:00Z`,
    };
}

function queryDoc(id: string, data: unknown) {
    return { id, data: () => data };
}

describe('CheckinService.upsertCheckin tissueResponses clearing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'daily_subjective_checkins' });
        firestore.doc.mockReturnValue({ path: 'daily_subjective_checkins/2026-08-09' });
        firestore.setDoc.mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (firestore.deleteField as any).mockReturnValue(DELETE_FIELD_SENTINEL);
    });

    it('explicitly deletes a previously-persisted tissueResponses field when painOrInjury is false', async () => {
        const service = new CheckinService();
        await service.upsertCheckin('u1', {
            ...baseCheckin,
            date: '2026-08-09',
            painOrInjury: false,
        });

        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.tissueResponses).toBe(DELETE_FIELD_SENTINEL);
        const options = firestore.setDoc.mock.calls[0][2] as Record<string, unknown>;
        expect(options).toEqual({ merge: true });
    });

    it('persists tissueResponses as-is when painOrInjury is true', async () => {
        const service = new CheckinService();
        await service.upsertCheckin('u1', {
            ...baseCheckin,
            date: '2026-08-09',
            painOrInjury: true,
            tissueResponses: { knee: { region: 'knee', morningState: 'mild' } },
        });

        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.tissueResponses).toEqual({ knee: { region: 'knee', morningState: 'mild' } });
    });
});

describe('CheckinService.getCheckinsInRangeState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'daily_subjective_checkins' });
        firestore.where.mockImplementation((...args: unknown[]) => args);
        firestore.orderBy.mockImplementation((...args: unknown[]) => args);
        firestore.query.mockImplementation((...args: unknown[]) => args);
    });

    it('builds a half-open date query so the decision date is not fetched', async () => {
        firestore.getDocs.mockResolvedValue({
            empty: false,
            docs: [queryDoc('2026-08-09', storedCheckin('2026-08-09'))],
        });
        const state = await new CheckinService().getCheckinsInRangeState('u1', '2026-07-13', '2026-08-10');
        expect(state.status).toBe('AVAILABLE');
        expect(firestore.where).toHaveBeenCalledWith('date', '>=', '2026-07-13');
        expect(firestore.where).toHaveBeenCalledWith('date', '<', '2026-08-10');
        expect(firestore.where).not.toHaveBeenCalledWith('date', '<=', '2026-08-10');
    });

    it('parses each row with path ownership/date authority and surfaces malformed rows without coercing them', async () => {
        firestore.getDocs.mockResolvedValue({
            empty: false,
            docs: [
                queryDoc('2026-08-08', storedCheckin('2026-08-08')),
                queryDoc('2026-08-09', { ...storedCheckin('2026-08-09'), userId: 'other-user' }),
            ],
        });
        const state = await new CheckinService().getCheckinsInRangeState('u1', '2026-07-13', '2026-08-10');
        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('expected available state');
        expect(state.data.map(item => item.date)).toEqual(['2026-08-08']);
        expect(state.issues).toEqual([
            expect.objectContaining({ code: 'user-id-mismatch', documentPath: 'users/u1/daily_subjective_checkins/2026-08-09' }),
        ]);
    });

    it('fails closed when every returned row is malformed', async () => {
        firestore.getDocs.mockResolvedValue({
            empty: false,
            docs: [queryDoc('2026-08-09', { ...storedCheckin('2026-08-09'), date: '2026-08-08' })],
        });
        const state = await new CheckinService().getCheckinsInRangeState('u1', '2026-07-13', '2026-08-10');
        expect(state.status).toBe('INVALID');
    });

    it('distinguishes an empty valid range from an unavailable query', async () => {
        firestore.getDocs.mockResolvedValueOnce({ empty: true, docs: [] });
        const missing = await new CheckinService().getCheckinsInRangeState('u1', '2026-07-13', '2026-08-10');
        expect(missing).toEqual({ status: 'MISSING' });

        firestore.getDocs.mockRejectedValueOnce(new Error('network'));
        const unavailable = await new CheckinService().getCheckinsInRangeState('u1', '2026-07-13', '2026-08-10');
        expect(unavailable).toMatchObject({ status: 'UNAVAILABLE', operation: 'read subjective check-in history' });
    });

    it('rejects impossible or malformed date ranges before querying Firestore', async () => {
        const service = new CheckinService();
        expect((await service.getCheckinsInRangeState('u1', 'bad', '2026-08-10')).status).toBe('INVALID');
        expect((await service.getCheckinsInRangeState('u1', '2026-08-10', '2026-08-10')).status).toBe('INVALID');
        expect(firestore.getDocs).not.toHaveBeenCalled();
    });
});
