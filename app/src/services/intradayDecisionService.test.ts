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
    deterministicIntradayDecisionId,
    decisionRecordsMatch,
    writeProvisionalDecisionInTransaction,
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
        predecessorExecutionId: null,
        predecessorOccurrenceId: null,
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
            bindings: [
                {
                    sessionId: 'sess-1',
                    windowId: 'win-1',
                    boundStartLocal: '08:00',
                    boundEndLocal: '09:00',
                    startInstant: '2026-09-06T06:00:00.000Z',
                    endInstant: '2026-09-06T07:00:00.000Z',
                },
            ],
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

    it('rejects saving a record with supersededDecisionId referencing a different occurrenceId', async () => {
        const priorRecord = sampleRecord('dec-1', { occurrenceId: 'occ-am' });
        const invalidSuperseding = sampleRecord('dec-2', {
            occurrenceId: 'occ-pm',
            supersededDecisionId: 'dec-1',
        });

        mockGetDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => priorRecord,
        });

        await expect(saveIntradayDecision(invalidSuperseding)).rejects.toThrow(
            /cannot supersede decision dec-1 for occurrence occ-am/
        );
        expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('does not suppress active decisions from other occurrences when a record contains a mismatched cross-occurrence supersededDecisionId', async () => {
        const occ1Decision = sampleRecord('dec-occ1', { occurrenceId: 'occ-1', status: 'provisional' });
        const occ2Decision = sampleRecord('dec-occ2', {
            occurrenceId: 'occ-2',
            status: 'confirmed',
            supersededDecisionId: 'dec-occ1',
        });

        mockGetDocs.mockResolvedValueOnce({
            docs: [{ data: () => occ1Decision }, { data: () => occ2Decision }],
        });

        const active = await getActiveIntradayDecisionsForDate('u1', '2026-09-06');
        expect(active.map(r => r.id).sort()).toEqual(['dec-occ1', 'dec-occ2']);
    });
});

describe('deterministicIntradayDecisionId (H4 #434 PR 3 step 9)', () => {
    const revision = {
        availabilityRevision: 'a1', completedFactsRevision: 'c1',
        checkinRevision: 'ch1', ledgerRevision: 'l1', placementRevision: 'p1',
    };

    it('is deterministic for the same occurrence and revision', async () => {
        const id1 = await deterministicIntradayDecisionId('occ-1', revision);
        const id2 = await deterministicIntradayDecisionId('occ-1', revision);
        expect(id1).toBe(id2);
    });

    it('differs when the occurrence differs', async () => {
        const id1 = await deterministicIntradayDecisionId('occ-1', revision);
        const id2 = await deterministicIntradayDecisionId('occ-2', revision);
        expect(id1).not.toBe(id2);
    });

    it('differs when the revision differs', async () => {
        const id1 = await deterministicIntradayDecisionId('occ-1', revision);
        const id2 = await deterministicIntradayDecisionId('occ-1', { ...revision, ledgerRevision: 'l2' });
        expect(id1).not.toBe(id2);
    });
});

describe('decisionRecordsMatch (H4 #434 PR 3 step 9)', () => {
    it('matches two records identical on every immutable field', () => {
        const a = sampleRecord('dec-1', { predecessorExecutionId: 'exec-1', predecessorOccurrenceId: 'occ-am' });
        const b = sampleRecord('dec-1', { predecessorExecutionId: 'exec-1', predecessorOccurrenceId: 'occ-am' });
        expect(decisionRecordsMatch(a, b)).toBe(true);
    });

    it('does not match when the verdict differs', () => {
        const a = sampleRecord('dec-1');
        const b = sampleRecord('dec-1', { verdict: { decision: 'defer', reasons: ['different'] } });
        expect(decisionRecordsMatch(a, b)).toBe(false);
    });

    it('does not match when only the predecessor differs -- two decisions colliding on one id are not the same decision', () => {
        const a = sampleRecord('dec-1', { predecessorExecutionId: 'exec-1', predecessorOccurrenceId: 'occ-am' });
        const b = sampleRecord('dec-1', { predecessorExecutionId: 'exec-2', predecessorOccurrenceId: 'occ-am-2' });
        expect(decisionRecordsMatch(a, b)).toBe(false);
    });

    it('does not match when the input revision differs', () => {
        const a = sampleRecord('dec-1');
        const b = sampleRecord('dec-1', {
            reassessmentInputRevision: { ...sampleRecord().reassessmentInputRevision, ledgerRevision: 'l2' },
        });
        expect(decisionRecordsMatch(a, b)).toBe(false);
    });
});

describe('writeProvisionalDecisionInTransaction (H4 #434 PR 3 step 9)', () => {
    function mockTransaction() {
        return { set: vi.fn() } as unknown as import('firebase/firestore').Transaction;
    }

    it('creates the record when none exists', () => {
        const tx = mockTransaction();
        const record = sampleRecord('dec-1');
        const result = writeProvisionalDecisionInTransaction(tx, 'u1', null, record);
        expect(result).toEqual(record);
        expect((tx as unknown as { set: ReturnType<typeof vi.fn> }).set).toHaveBeenCalledTimes(1);
    });

    it('is a no-op returning the existing record on a matching retry', () => {
        const tx = mockTransaction();
        const existing = sampleRecord('dec-1');
        const retry = sampleRecord('dec-1');
        const result = writeProvisionalDecisionInTransaction(tx, 'u1', existing, retry);
        expect(result).toBe(existing);
        expect((tx as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
    });

    it('throws on a conflicting record at the same id rather than overwriting', () => {
        const tx = mockTransaction();
        const existing = sampleRecord('dec-1', { occurrenceId: 'occ-1' });
        const conflicting = sampleRecord('dec-1', { occurrenceId: 'occ-2' });
        expect(() => writeProvisionalDecisionInTransaction(tx, 'u1', existing, conflicting)).toThrow(
            /already holds a different decision/,
        );
        expect((tx as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
    });

    it('rejects records with non-provisional status', () => {
        const tx = mockTransaction();
        const nonProvisional = sampleRecord('dec-1', { status: 'confirmed' });
        expect(() => writeProvisionalDecisionInTransaction(tx, 'u1', null, nonProvisional)).toThrow(
            TypeError,
        );
        expect(() => writeProvisionalDecisionInTransaction(tx, 'u1', null, nonProvisional)).toThrow(
            /requires status "provisional"/,
        );
        expect((tx as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
    });

    it('rejects records where userId does not match the path userId', () => {
        const tx = mockTransaction();
        const mismatchedUser = sampleRecord('dec-1', { userId: 'u2' });
        expect(() => writeProvisionalDecisionInTransaction(tx, 'u1', null, mismatchedUser)).toThrow(
            TypeError,
        );
        expect(() => writeProvisionalDecisionInTransaction(tx, 'u1', null, mismatchedUser)).toThrow(
            /userId must match record\.userId/,
        );
        expect((tx as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
    });
});