import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(() => ({ __ref: true })),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import {
    getIntradayBundlePlacement,
    getIntradayBundlePlacementAudit,
    recordIntradayBundlePlacement,
    recordIntradayBundlePlacementAudit,
    replayIntradayBundlePlacementAudit,
    type IntradayBundlePlacementAuditInput,
    type IntradayBundlePlacementAudit,
} from './intradayBundlePlacementAuditService';
import type { BundlePlacementProposal } from '../engine/intradayBundlePlacement';
import type { IntradayBundleMember } from '../engine/intradayBundlePlacement';
import { POLICY_VERSION } from '../engine/policy';
import { computeContentHash } from '../engine/externalPlanHash';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import type { ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';
import type { SessionDefinition } from '../sessions/models';

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

async function auditInput(): Promise<IntradayBundlePlacementAuditInput> {
    const member: IntradayBundleMember = {
        sessionId: 's1', order: 1, priority: 'key', requestedWindow: { startLocal: '06:00', endLocal: '07:00' },
        estimatedMinutes: 45, estimatedSystemicCost: 0.2, started: false,
    };
    const planSnapshot: ExternalTrainingPlanV4 = {
        schema: 'adaptive-training-recommender/external-plan@4' as const,
        planId: 'plan-1', revision: 2, title: 'Test plan', startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 's1', title: 'Test session', priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
            intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'bundle-1', order: 1 },
            definition: fixture01 as unknown as SessionDefinition,
        }], restDays: [],
    };
    return {
        userId: 'u1', date: '2026-08-18', asOf: '2026-08-18T05:00:00.000Z', policyVersion: POLICY_VERSION,
        plan: { planId: 'plan-1', revision: 2, contentHash: await computeContentHash(planSnapshot) }, planSnapshot, bundleId: 'bundle-1',
        scheduleWindows: [{ id: 'w1', userId: 'u1', date: '2026-08-18', startLocal: '06:00', endLocal: '08:00', revision: 1, createdAt: 'x', updatedAt: 'x' }],
        fixedActivities: [], restDates: [], planSessions: [{ sessionId: 's1', date: '2026-08-18', status: 'planned' }], members: [member],
        ledger: { ceilings: { dailyMinuteCeiling: 60, dailySystemicCostCeiling: 1 }, entries: [], result: { remainingMinutes: 60, remainingSystemicCost: 1, unresolvedEntries: [] } },
        proposal: { bundleId: 'bundle-1', outcome: 'placed', bindings: [{ sessionId: 's1', windowId: 'w1', boundStartLocal: '06:00', boundEndLocal: '07:00', startInstant: '2026-08-18T04:00:00.000Z', endInstant: '2026-08-18T05:00:00.000Z' }] },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
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

describe('immutable intraday placement audit', () => {
    it('replays cleanly from the frozen inputs', async () => {
        const input = await auditInput();
        const audit = await recordIntradayBundlePlacementAudit(input);
        await expect(replayIntradayBundlePlacementAudit(audit)).resolves.toEqual({ valid: true, failures: [] });
    });

    it('replays a ledger snapshot with a consumed reservation exactly once', async () => {
        const input = await auditInput();
        input.ledger = {
            ceilings: { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 },
            entries: [{ occurrenceId: 'fixed:class', revision: 1, reservedMinutes: 30, reservedSystemicCost: 0.2, state: 'reserved' }],
            result: { remainingMinutes: 60, remainingSystemicCost: 0.8, unresolvedEntries: [] },
        };
        const audit = await recordIntradayBundlePlacementAudit(input);
        await expect(replayIntradayBundlePlacementAudit(audit)).resolves.toEqual({ valid: true, failures: [] });
    });

    it('normalizes undefined optional member fields before hashing the persisted snapshot', async () => {
        const input = await auditInput();
        input.members[0].afterSessionId = undefined;
        input.members[0].minimumSeparationMinutes = undefined;
        const audit = await recordIntradayBundlePlacementAudit(input);
        expect('afterSessionId' in audit.members[0]).toBe(false);
        expect('minimumSeparationMinutes' in audit.members[0]).toBe(false);
        await expect(replayIntradayBundlePlacementAudit(audit)).resolves.toEqual({ valid: true, failures: [] });
    });

    it('rejects malformed nested member snapshots and tampered as-of integrity', async () => {
        const audit = await recordIntradayBundlePlacementAudit(await auditInput());
        audit.members[0].requestedWindow = undefined as never;
        const malformed = await replayIntradayBundlePlacementAudit(audit);
        expect(malformed.valid).toBe(false);
        expect(malformed.failures.some(failure => failure.includes('member'))).toBe(true);

        const intact = await recordIntradayBundlePlacementAudit(await auditInput());
        intact.asOf = '2026-08-18T06:00:00.000Z';
        const tampered = await replayIntradayBundlePlacementAudit(intact);
        expect(tampered.valid).toBe(false);
        expect(tampered.failures).toContain('snapshot integrity/hash mismatch');
    });

    it.each([
        ['ledger ceiling', (audit: IntradayBundlePlacementAudit) => { audit.ledger.ceilings.dailyMinuteCeiling = 1; }],
        ['placement', (audit: IntradayBundlePlacementAudit) => { audit.proposal.bindings![0].windowId = 'other'; }],
        ['plan identity', (audit: IntradayBundlePlacementAudit) => { audit.plan.contentHash = 'b'.repeat(64); }],
    ])('reports tampered %s', async (_label, tamper) => {
        const audit = await recordIntradayBundlePlacementAudit(await auditInput());
        tamper(audit);
        const result = await replayIntradayBundlePlacementAudit(audit);
        expect(result.valid).toBe(false);
        expect(result.failures.length).toBeGreaterThan(0);
    });

    it('uses a deterministic identity and is idempotent on retry', async () => {
        const writes: unknown[] = [];
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }) => unknown) => updateFn({
            get: vi.fn().mockResolvedValue(writes.length === 0 ? { exists: () => false } : { exists: () => true, data: () => writes[0] }),
            set: vi.fn((_ref: unknown, value: unknown) => writes.push(value)),
        }));
        const first = await recordIntradayBundlePlacementAudit(await auditInput());
        const laterInput = { ...(await auditInput()), asOf: '2026-08-18T06:00:00.000Z' };
        const second = await recordIntradayBundlePlacementAudit(laterInput);
        expect(first.auditId).toBe(second.auditId);
        expect(second.snapshotHash).toBe(first.snapshotHash);
        expect(writes).toHaveLength(1);
        expect((writes[0] as IntradayBundlePlacementAudit).auditId).toBe(first.auditId);
    });

    it('reads the immutable audit while retaining the legacy date-level reader', async () => {
        const audit = { ...(await auditInput()), schemaVersion: 'intraday_bundle_placement_audit_v1' as const, auditId: 'audit_1', snapshotHash: 'a'.repeat(64), createdAt: '2026-08-18T05:00:00Z' };
        firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => audit });
        await expect(getIntradayBundlePlacementAudit('u1', 'audit_1')).resolves.toEqual(audit);
        const legacy = persistedRecord();
        firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => legacy });
        await expect(getIntradayBundlePlacement('u1', '2026-08-18')).resolves.toEqual(legacy);
    });

    it('rejects an audit whose persisted document path does not match its payload identity', async () => {
        const audit = { ...(await auditInput()), schemaVersion: 'intraday_bundle_placement_audit_v1' as const, auditId: 'audit_1', snapshotHash: 'a'.repeat(64), createdAt: '2026-08-18T05:00:00Z' };
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => audit });
        await expect(getIntradayBundlePlacementAudit('u1', 'audit_other')).rejects.toThrow('path identity mismatch');
    });
});
