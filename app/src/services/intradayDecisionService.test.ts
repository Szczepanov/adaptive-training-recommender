import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IntradayDecisionRecord } from '../engine/intradayDecision';
import {
    getIntradayDecisionDocPath,
    getIntradayDecisionsCollectionPath,
    saveIntradayDecision,
    getIntradayDecision,
    listIntradayDecisionsForDate,
    getActiveIntradayDecisionsForDate,
    getActiveIntradayDecisionForOccurrence,
} from './intradayDecisionService';

const mockSetDoc = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, path) => ({ path })),
    collection: vi.fn((_db, path) => ({ path })),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    query: vi.fn((col, ...clauses) => ({ col, clauses })),
    where: vi.fn((field, op, val) => ({ field, op, val })),
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

function sampleRecord(id = 'dec-1', overrides: Partial<IntradayDecisionRecord> = {}): IntradayDecisionRecord {
    return {
        id,
        userId: 'u1',
        date: '2026-09-06',
        asOf: '2026-09-06T07:00:00.000Z',
        policyVersion: 'test-policy',
        schemaVersion: 1,
        status: 'provisional',
        supersededDecisionId: null,
        occurrenceId: 'occ-1',
        sessionId: 'sess-1',
        windowId: 'win-1',
        bundleId: 'bundle-1',
        orderInBundle: 0,
        reassessmentInputRevision: {
            availabilityRevision: 'a1',
            completedFactsRevision: 'c1',
            checkinRevision: 'ch1',
            ledgerRevision: 'l1',
            placementRevision: 'p1',
        },
        bundlePlacement: {
            bundleId: 'bundle-1',
            outcome: 'placed',
            bindings: [],
        },
        ledgerSnapshot: {
            ceilings: { dailyMinuteCeiling: 60, dailySystemicCostCeiling: 0.5 },
            entries: [],
        },
        verdict: { decision: 'proceed', reasons: ['ok'] },
        ...overrides,
    };
}

describe('intradayDecisionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generates expected user-scoped Firestore paths', () => {
        expect(getIntradayDecisionDocPath('u1', 'dec-123')).toBe('users/u1/intraday_decisions/dec-123');
        expect(getIntradayDecisionsCollectionPath('u1')).toBe('users/u1/intraday_decisions');
    });

    it('saves a valid intraday decision record write-once', async () => {
        const record = sampleRecord();
        await saveIntradayDecision(record);
        expect(mockSetDoc).toHaveBeenCalledWith({ path: 'users/u1/intraday_decisions/dec-1' }, record);
    });

    it('retrieves an existing intraday decision record', async () => {
        const record = sampleRecord();
        mockGetDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => record,
        });

        const result = await getIntradayDecision('u1', 'dec-1');
        expect(result).toEqual(record);
    });

    it('returns null when retrieving a non-existent decision', async () => {
        mockGetDoc.mockResolvedValueOnce({
            exists: () => false,
        });

        const result = await getIntradayDecision('u1', 'dec-missing');
        expect(result).toBeNull();
    });

    it('lists and sorts intraday decisions for a date', async () => {
        const d1 = sampleRecord('dec-1', { asOf: '2026-09-06T09:00:00.000Z' });
        const d2 = sampleRecord('dec-2', { asOf: '2026-09-06T07:00:00.000Z' });

        mockGetDocs.mockResolvedValueOnce({
            docs: [{ data: () => d1 }, { data: () => d2 }],
        });

        const result = await listIntradayDecisionsForDate('u1', '2026-09-06');
        expect(result.map(r => r.id)).toEqual(['dec-2', 'dec-1']);
    });

    it('filters out superseded decision records when getting active decisions', async () => {
        const original = sampleRecord('dec-1', { status: 'superseded', asOf: '2026-09-06T07:00:00.000Z' });
        const superseding = sampleRecord('dec-2', {
            supersededDecisionId: 'dec-1',
            status: 'confirmed',
            asOf: '2026-09-06T08:00:00.000Z',
        });

        mockGetDocs.mockResolvedValueOnce({
            docs: [{ data: () => original }, { data: () => superseding }],
        });

        const active = await getActiveIntradayDecisionsForDate('u1', '2026-09-06');
        expect(active.map(r => r.id)).toEqual(['dec-2']);

        mockGetDocs.mockResolvedValueOnce({
            docs: [{ data: () => original }, { data: () => superseding }],
        });
        const activeOccurrence = await getActiveIntradayDecisionForOccurrence('u1', '2026-09-06', 'occ-1');
        expect(activeOccurrence?.id).toBe('dec-2');
    });
});
