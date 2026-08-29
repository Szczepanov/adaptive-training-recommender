import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailySubjectiveCheckin } from '../engine/models';

const DELETE_FIELD_SENTINEL = Symbol('deleteField');
const firestore = vi.hoisted(() => ({
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
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { CheckinService } from './checkinService';

const baseCheckin: Partial<DailySubjectiveCheckin> = {
    date: '2026-08-21',
    readiness: 7,
    sleepQuality: 7,
    fatigue: 4,
    soreness: 3,
    mentalStress: 4,
    motivation: 8,
    painOrInjury: false,
    illnessSymptoms: false,
    unusuallyLimitedTime: false,
    alreadyTrainedToday: false,
    availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
};

describe('CheckinService HA1 health-context persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'daily_subjective_checkins' });
        firestore.doc.mockReturnValue({ path: 'users/u1/daily_subjective_checkins/2026-08-21' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.deleteField.mockReturnValue(DELETE_FIELD_SENTINEL);
    });

    it('persists a context-only symptom report with canonical contextual defaults', async () => {
        const input = { ...baseCheckin, healthContext: { symptoms: { present: true as const } } };
        delete input.illnessSymptoms;
        const result = await new CheckinService().upsertCheckin('u1', input);

        expect(result.illnessSymptoms).toBe(true);
        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.illnessSymptoms).toBe(true);
        const context = payload.healthContext as Record<string, unknown>;
        expect(context.alcoholDrinksLast24h).toBe(0);
        expect(context.travelDisruption).toBe('none');
        expect(context.unusualHeatOrSauna).toBe(false);
        expect(context.dehydrationOrFluidLoss).toBe(false);
        expect(context.recentVaccination).toBe(false);
        expect(context.medicationChange).toBe(false);
        expect(context.closeSickContact).toBe(false);
        expect(context.symptoms).toEqual({
            present: true,
            onset: DELETE_FIELD_SENTINEL,
            severity: DELETE_FIELD_SENTINEL,
            types: DELETE_FIELD_SENTINEL,
            suspectedCause: DELETE_FIELD_SENTINEL,
        });
    });

    it('deletes the whole stored context when this write omits it', async () => {
        await new CheckinService().upsertCheckin('u1', baseCheckin);

        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.healthContext).toBe(DELETE_FIELD_SENTINEL);
        expect(firestore.setDoc.mock.calls[0][2]).toEqual({ merge: true });
    });

    it('normalizes any supplied context block to the canonical product defaults', async () => {
        await new CheckinService().upsertCheckin('u1', {
            ...baseCheckin,
            healthContext: {
                closeSickContact: false,
                recentVaccination: null,
            },
        });

        const payload = firestore.setDoc.mock.calls[0][1] as {
            healthContext: Record<string, unknown>;
        };
        expect(payload.healthContext.alcoholDrinksLast24h).toBe(0);
        expect(payload.healthContext.travelDisruption).toBe('none');
        expect(payload.healthContext.unusualHeatOrSauna).toBe(false);
        expect(payload.healthContext.dehydrationOrFluidLoss).toBe(false);
        expect(payload.healthContext.recentVaccination).toBe(false);
        expect(payload.healthContext.medicationChange).toBe(false);
        expect(payload.healthContext.closeSickContact).toBe(false);
        expect(payload.healthContext.symptoms).toEqual({
            present: false,
            onset: DELETE_FIELD_SENTINEL,
            severity: DELETE_FIELD_SENTINEL,
            types: DELETE_FIELD_SENTINEL,
            suspectedCause: DELETE_FIELD_SENTINEL,
        });
    });

    it('explicitly clears stale nested symptom details when present becomes false', async () => {
        const result = await new CheckinService().upsertCheckin('u1', {
            ...baseCheckin,
            illnessSymptoms: true,
            healthContext: { symptoms: { present: false } },
        });

        expect(result.illnessSymptoms).toBe(false);
        const payload = firestore.setDoc.mock.calls[0][1] as {
            illnessSymptoms: boolean;
            healthContext: { symptoms: Record<string, unknown> };
        };
        expect(payload.illnessSymptoms).toBe(false);
        expect(payload.healthContext.symptoms).toEqual({
            present: false,
            onset: DELETE_FIELD_SENTINEL,
            severity: DELETE_FIELD_SENTINEL,
            types: DELETE_FIELD_SENTINEL,
            suspectedCause: DELETE_FIELD_SENTINEL,
        });
        expect(firestore.setDoc.mock.calls[0][2]).toEqual({ merge: true });
    });

    it('persists an allergy-attributed symptom report with its suspected cause and types', async () => {
        await new CheckinService().upsertCheckin('u1', {
            ...baseCheckin,
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'mild',
                    types: ['sneezing', 'runny_nose'],
                    suspectedCause: 'allergy',
                },
            },
        });

        const payload = firestore.setDoc.mock.calls[0][1] as { healthContext: { symptoms: Record<string, unknown> } };
        expect(payload.healthContext.symptoms).toEqual({
            present: true,
            onset: DELETE_FIELD_SENTINEL,
            severity: 'mild',
            types: ['sneezing', 'runny_nose'],
            suspectedCause: 'allergy',
        });
    });

    it('rejects a clear carrying stale symptom details before writing', async () => {
        await expect(new CheckinService().upsertCheckin('u1', {
            ...baseCheckin,
            healthContext: { symptoms: { present: false, onset: 'today' } },
        })).rejects.toThrow('healthContext.symptoms.onset');
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });
});
