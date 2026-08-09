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
            // No tissueResponses supplied on this write -- this is exactly the case where
            // an omit-if-empty validator would otherwise leave a stale Firestore value in
            // place under `merge: true`.
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
