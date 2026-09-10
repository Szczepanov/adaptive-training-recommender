import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(() => ({ __ref: true })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    collection: vi.fn(() => ({ __collection: true })),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

const profileState = vi.hoisted(() => ({ getProfileState: vi.fn() }));
vi.mock('./trainingIntentProfileService', () => ({
    trainingIntentProfileService: profileState,
    // `IntentBlockService.save` constructs its own db-bound instance rather than using the
    // singleton (see intentBlockService.ts's resolvePinnedProfile doc comment) -- `new`ing
    // this mock must resolve to the same controllable object as the singleton above.
    TrainingIntentProfileService: vi.fn().mockImplementation(function TrainingIntentProfileService() { return profileState; }),
}));

import {
    IntentBlockService,
    IntentBlockRevisionNotNewerError,
    IntentBlockValidationFailedError,
    MissingTrainingIntentProfileError,
    manualIntentBlockSourceIdentity,
    MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
    type IntentBlockHeader,
} from './intentBlockService';
import type { IntentBlock } from '../engine/blockIntent';

const USER_ID = 'u1';

function block(overrides: Partial<IntentBlock> = {}): IntentBlock {
    const { sourcePlanId, sourcePlanRevision } = manualIntentBlockSourceIdentity('block_1');
    return {
        id: 'block_1',
        revision: 1,
        sourcePlanId,
        sourcePlanRevision,
        dateRange: { startDate: '2026-09-07', endDate: '2026-10-04' },
        objectives: [{
            id: 'obj_1',
            sport: 'cycling',
            adaptationScope: 'threshold_quality',
            coverageKey: 'sustained_quality',
            intent: 'develop',
            priority: 'must_have',
            doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
            knowledgeLineage: ['athlete-authored-manual-v1'],
            successCriteria: { minCompletedExposures: 3 },
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-21' },
        ...overrides,
    };
}

function trainingIntentProfile() {
    return {
        userId: USER_ID,
        planningMode: 'evergreen' as const,
        priorities: ['balanced_performance' as const],
        weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
        organizationPreference: 'auto' as const,
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    profileState.getProfileState.mockResolvedValue({ status: 'AVAILABLE', data: trainingIntentProfile(), revision: 'x' });
});

describe('IntentBlockService.save', () => {
    it('rejects an invalid block before any write', async () => {
        const service = new IntentBlockService();
        const invalid = block({ objectives: [] });

        await expect(service.save(USER_ID, invalid)).rejects.toBeInstanceOf(IntentBlockValidationFailedError);
        expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    it('refuses to author a block with no training intent profile configured', async () => {
        profileState.getProfileState.mockResolvedValue({ status: 'MISSING' });
        const service = new IntentBlockService();

        await expect(service.save(USER_ID, block())).rejects.toBeInstanceOf(MissingTrainingIntentProfileError);
        expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    it('creates the first revision, pinning the profile and a manual source identity', async () => {
        let writtenHeader: unknown;
        let writtenRevision: unknown;
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
                set: vi.fn((ref: { __ref: true }, data: unknown) => {
                    void ref;
                    if (writtenHeader === undefined) writtenHeader = data;
                    else writtenRevision = data;
                }),
            };
            return updateFn(transaction);
        });

        const service = new IntentBlockService();
        const header = await service.save(USER_ID, block()) as IntentBlockHeader;

        expect(header.revision).toBe(1);
        expect(header.sourcePlanId).toBe('block_1');
        expect(header.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(writtenHeader).toMatchObject({ blockId: 'block_1', revision: 1 });
        expect(writtenRevision).toMatchObject({
            blockId: 'block_1', revision: 1, sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
        });
        expect((writtenRevision as { pinnedTrainingIntentProfile: { priorities: string[] } }).pinnedTrainingIntentProfile.priorities).toEqual(['balanced_performance']);
    });

    it('rejects a revision that is not newer than the stored one, writing nothing', async () => {
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => ({ userId: USER_ID, blockId: 'block_1', revision: 2, contentHash: 'a'.repeat(64), sourcePlanId: 'block_1', sourcePlanRevision: 1, createdAt: 'x', updatedAt: 'x' }),
                }),
                set: vi.fn(),
            };
            return updateFn(transaction);
        });

        const service = new IntentBlockService();
        await expect(service.save(USER_ID, block({ revision: 2 }))).rejects.toBeInstanceOf(IntentBlockRevisionNotNewerError);
    });

    it('accepts a strictly newer revision, preserving the original createdAt', async () => {
        let writtenHeader: unknown;
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => {
            const transaction = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => ({ userId: USER_ID, blockId: 'block_1', revision: 1, contentHash: 'a'.repeat(64), sourcePlanId: 'block_1', sourcePlanRevision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
                }),
                set: vi.fn((_ref, data) => { writtenHeader ??= data; }),
            };
            return updateFn(transaction);
        });

        const service = new IntentBlockService();
        const header = await service.save(USER_ID, block({ revision: 2 })) as IntentBlockHeader;

        expect(header.revision).toBe(2);
        expect(header.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
});

describe('IntentBlockService.getHeaderState / getRevisionState', () => {
    it('returns MISSING when no header exists', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const service = new IntentBlockService();
        await expect(service.getHeaderState(USER_ID, 'block_1')).resolves.toEqual({ status: 'MISSING' });
    });

    it('flags an owner mismatch as INVALID rather than returning it', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ userId: 'someone-else', blockId: 'block_1', revision: 1, contentHash: 'a'.repeat(64), sourcePlanId: 'block_1', sourcePlanRevision: 1, createdAt: 'x', updatedAt: 'x' }),
        });
        const service = new IntentBlockService();
        const state = await service.getHeaderState(USER_ID, 'block_1');
        expect(state.status).toBe('INVALID');
    });

    it('re-validates a revision on read and flags a corrupted block as INVALID', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ userId: USER_ID, blockId: 'block_1', revision: 1, block: block({ objectives: [] }), pinnedTrainingIntentProfile: {}, sourceSchemaVersion: 'x', sourceRef: null, contentHash: 'a'.repeat(64), createdAt: 'x' }),
        });
        const service = new IntentBlockService();
        const state = await service.getRevisionState(USER_ID, 'block_1', 1);
        expect(state.status).toBe('INVALID');
    });
});

describe('IntentBlockService.getActiveBlocks', () => {
    it('keeps only blocks whose latest revision is AVAILABLE and whose dateRange covers the date', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [{ id: 'active' }, { id: 'expired' }, { id: 'header_missing' }, { id: 'revision_invalid' }] });
        const service = new IntentBlockService();
        const activeBlock = block({ id: 'active', dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' } });
        const expiredBlock = block({ id: 'expired', dateRange: { startDate: '2026-01-01', endDate: '2026-01-31' } });
        vi.spyOn(service, 'getHeaderState').mockImplementation(async (_userId, blockId) => {
            if (blockId === 'header_missing') return { status: 'MISSING' };
            return { status: 'AVAILABLE', data: { revision: 1 } as unknown as IntentBlockHeader, revision: 'x' };
        });
        vi.spyOn(service, 'getRevisionState').mockImplementation(async (_userId, blockId) => {
            if (blockId === 'active') return { status: 'AVAILABLE', data: { block: activeBlock } as never, revision: '1' };
            if (blockId === 'expired') return { status: 'AVAILABLE', data: { block: expiredBlock } as never, revision: '1' };
            return { status: 'INVALID', issues: [] };
        });

        const result = await service.getActiveBlocks(USER_ID, '2026-09-10');
        expect(result.status).toBe('AVAILABLE');
        expect(result.status === 'AVAILABLE' && result.data.map(b => b.id)).toEqual(['active']);
    });

    it('passes through a non-AVAILABLE listBlockIds result unchanged', async () => {
        firestore.getDocs.mockRejectedValue(new Error('offline'));
        const service = new IntentBlockService();
        const result = await service.getActiveBlocks(USER_ID, '2026-09-10');
        expect(result.status).toBe('UNAVAILABLE');
    });
});
