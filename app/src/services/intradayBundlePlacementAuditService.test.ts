import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(() => ({ __ref: true })),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { getIntradayBundlePlacement, recordIntradayBundlePlacement } from './intradayBundlePlacementAuditService';
import type { BundlePlacementProposal } from '../engine/intradayBundlePlacement';

function placedProposal(): BundlePlacementProposal {
    return {
        bundleId: 'bundle-1',
        outcome: 'placed',
        bindings: [
            {
                sessionId: 'w1-am', windowId: 'win-am',
                boundStartLocal: '06:00', boundEndLocal: '07:00',
                startInstant: '2026-08-18T04:00:00.000Z', endInstant: '2026-08-18T05:00:00.000Z',
            },
        ],
    };
}

function persistedRecord(overrides: Record<string, unknown> = {}) {
    return {
        userId: 'u1',
        date: '2026-08-18',
        bundleId: 'old-bundle',
        outcome: 'infeasible',
        bindings: [],
        reason: 'old placement',
        revision: 3,
        createdAt: '2026-08-17T05:00:00.000Z',
        updatedAt: '2026-08-18T05:00:00.000Z',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('recordIntradayBundlePlacement', () => {
    it('writes revision 1 with createdAt/updatedAt when no prior document exists', async () => {
        let written: unknown;
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
                set: vi.fn((_ref: unknown, record: unknown) => { written = record; }),
            };
            return updateFn(transaction);
        });

        await recordIntradayBundlePlacement('u1', '2026-08-18', placedProposal());

        expect(written).toMatchObject({
            userId: 'u1', date: '2026-08-18', bundleId: 'bundle-1', outcome: 'placed',
            revision: 1, reason: null,
        });
        expect((written as { bindings: unknown[] }).bindings).toHaveLength(1);
        expect((written as { createdAt: string }).createdAt).toBe((written as { updatedAt: string }).updatedAt);
    });

    it('increments revision and preserves createdAt on a later observation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-18T06:00:00.000Z'));
        let written: unknown;
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => persistedRecord(),
                }),
                set: vi.fn((_ref: unknown, record: unknown) => { written = record; }),
            };
            return updateFn(transaction);
        });

        await recordIntradayBundlePlacement('u1', '2026-08-18', placedProposal());

        expect(written).toMatchObject({
            revision: 4,
            createdAt: '2026-08-17T05:00:00.000Z',
            updatedAt: '2026-08-18T06:00:00.000Z',
        });
    });

    it('does not let an older observation overwrite evidence that committed later', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-18T06:00:00.000Z'));
        const set = vi.fn();
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => updateFn({
            get: vi.fn().mockResolvedValue({
                exists: () => true,
                data: () => persistedRecord({ updatedAt: '2026-08-18T06:00:00.001Z' }),
            }),
            set,
        }));

        await recordIntradayBundlePlacement('u1', '2026-08-18', placedProposal());

        expect(set).not.toHaveBeenCalled();
    });

    it('does not manufacture a new revision when the placement evidence is unchanged', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-18T06:00:00.000Z'));
        const proposal = placedProposal();
        const set = vi.fn();
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => updateFn({
            get: vi.fn().mockResolvedValue({
                exists: () => true,
                data: () => persistedRecord({
                    bundleId: proposal.bundleId,
                    outcome: proposal.outcome,
                    bindings: proposal.bindings,
                    reason: null,
                }),
            }),
            set,
        }));

        await recordIntradayBundlePlacement('u1', '2026-08-18', proposal);

        expect(set).not.toHaveBeenCalled();
    });

    it('records an infeasible outcome with an empty bindings list and the reason, not a fabricated binding', async () => {
        let written: unknown;
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
                set: vi.fn((_ref: unknown, record: unknown) => { written = record; }),
            };
            return updateFn(transaction);
        });

        await recordIntradayBundlePlacement('u1', '2026-08-18', {
            bundleId: 'bundle-1', outcome: 'infeasible', reason: 'insufficient daily systemic-cost budget',
        });

        expect(written).toMatchObject({ outcome: 'infeasible', bindings: [], reason: 'insufficient daily systemic-cost budget' });
    });

    it('never throws when the transaction fails -- a display-only write must not fail the caller', async () => {
        firestore.runTransaction.mockRejectedValue(new Error('offline'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(recordIntradayBundlePlacement('u1', '2026-08-18', placedProposal())).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});

describe('getIntradayBundlePlacement', () => {
    it('returns null when no document has been recorded', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
        await expect(getIntradayBundlePlacement('u1', '2026-08-18')).resolves.toBeNull();
    });

    it('returns the persisted record when present', async () => {
        const record = { userId: 'u1', date: '2026-08-18', bundleId: 'bundle-1', outcome: 'placed', bindings: [], reason: null, revision: 1, createdAt: 'x', updatedAt: 'x' };
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => record });
        await expect(getIntradayBundlePlacement('u1', '2026-08-18')).resolves.toEqual(record);
    });
});
