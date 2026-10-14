import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ __ref: true, path: path.join('/') })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    collection: vi.fn(() => ({ __collection: true })),
    query: vi.fn(() => ({ __query: true })),
    documentId: vi.fn(() => '__name__'),
    orderBy: vi.fn(() => ({ __orderBy: true })),
    limit: vi.fn(() => ({ __limit: true })),
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
    MANUAL_EVENT_DEVELOPMENT_SOURCE_SCHEMA_VERSION,
    type IntentBlockHeader,
} from './intentBlockService';
import type { IntentBlock } from '../engine/blockIntent';
import { buildTreatmentIntentReplayPayloadV1, hashTreatmentIntentReplayPayload } from '../engine/blockIntentReplay';

describe('bounded intent block review listing', () => {
    it('bounds IDs before hydration and reports the extra ID as truncation', async () => {
        firestore.getDocs.mockResolvedValueOnce({ docs: ['a', 'b', 'sentinel'].map(id => ({ id })) });
        const state = await new IntentBlockService({} as never).listBlockIds('u1', 2);
        expect(state).toMatchObject({ status: 'AVAILABLE', data: ['a', 'b'], issues: [{ code: 'intent-block-list-truncated' }] });
        expect(firestore.limit).toHaveBeenCalledWith(3);
    });
});

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

    it('persists explicit event binding through the existing save boundary under manual v2', async () => {
        const writes: unknown[] = [];
        firestore.runTransaction.mockImplementation(async (_db: unknown, updateFn: (t: unknown) => unknown) => updateFn({
            get: vi.fn().mockResolvedValue({ exists: () => false }), set: vi.fn((_ref: unknown, value: unknown) => writes.push(value)),
        }));
        const authored = block({ eventBinding: { eventId: 'race', eventDate: '2027-07-01',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 } } });
        await new IntentBlockService().save(USER_ID, authored);
        expect(writes[1]).toMatchObject({ sourceSchemaVersion: MANUAL_EVENT_DEVELOPMENT_SOURCE_SCHEMA_VERSION,
            block: { eventBinding: authored.eventBinding } });
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

describe('IntentBlockService.getActiveBlocksWithDiagnostics', () => {
    async function mockStoredBlocks(blocks: IntentBlock[], overrides: Record<string, unknown> = {}) {
        const profile = trainingIntentProfile();
        const pinnedTrainingIntentProfile = {
            priorities: profile.priorities,
            weeklyCommitment: profile.weeklyCommitment,
            schemaVersion: profile.schemaVersion,
        };
        const documents: Record<string, unknown> = {};
        for (const authoredBlock of blocks) {
            const contentHash = await hashTreatmentIntentReplayPayload(buildTreatmentIntentReplayPayloadV1(
                authoredBlock, pinnedTrainingIntentProfile, MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
            ));
            const path = `users/${USER_ID}/intent_blocks/${authoredBlock.id}`;
            documents[path] = {
                userId: USER_ID, blockId: authoredBlock.id, revision: authoredBlock.revision,
                sourcePlanId: authoredBlock.sourcePlanId, sourcePlanRevision: authoredBlock.sourcePlanRevision,
                contentHash, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
            };
            documents[`${path}/revisions/${authoredBlock.revision}`] = {
                userId: USER_ID, blockId: authoredBlock.id, revision: authoredBlock.revision, block: authoredBlock,
                pinnedTrainingIntentProfile, sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
                sourceRef: null, contentHash, createdAt: '2026-09-01T00:00:00Z',
            };
        }
        Object.assign(documents, overrides);
        firestore.getDoc.mockImplementation(async ({ path }: { path: string }) => {
            const data = documents[path];
            if (data instanceof Error) throw data;
            return { exists: () => data !== undefined, data: () => data };
        });
    }

    it('limits the default ID-ordered sample to 20 reads and leaves the sentinel unread', async () => {
        const blocks = Array.from({ length: 21 }, (_, index) => block({ id: `block_${String(index).padStart(2, '0')}` }));
        firestore.getDocs.mockResolvedValue({ docs: blocks.map(({ id }) => ({ id })) });
        await mockStoredBlocks(blocks);

        const result = await new IntentBlockService().getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10');

        expect(result.blocks.map(({ id }) => id)).toEqual(blocks.slice(0, 20).map(({ id }) => id));
        expect(result).toMatchObject({ unreadableCount: 0, truncated: true });
        expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'users', USER_ID, 'intent_blocks');
        expect(firestore.orderBy).toHaveBeenCalledWith('__name__', 'asc');
        expect(firestore.limit).toHaveBeenCalledWith(21);
        expect(firestore.query).toHaveBeenCalledWith({ __collection: true }, { __orderBy: true }, { __limit: true });
        expect(firestore.getDocs).toHaveBeenCalledWith({ __query: true });
        expect(firestore.getDoc).toHaveBeenCalledTimes(40);
        expect(firestore.getDoc).not.toHaveBeenCalledWith(expect.objectContaining({ path: `users/${USER_ID}/intent_blocks/block_20` }));
    });

    it('honors a smaller limit without treating inactive blocks as unreadable or backfilling the sample', async () => {
        const inactive = block({
            id: 'a', dateRange: { startDate: '2026-01-01', endDate: '2026-01-31' },
            reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-01-14' },
        });
        const active = block({ id: 'b' });
        firestore.getDocs.mockResolvedValue({ docs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
        await mockStoredBlocks([inactive, active]);

        const result = await new IntentBlockService().getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10', 2);

        expect(result).toEqual({ blocks: [active], unreadableCount: 0, truncated: true });
        expect(firestore.limit).toHaveBeenCalledWith(3);
        expect(firestore.getDoc).toHaveBeenCalledTimes(4);
    });

    it('loads next-block context in a bounded range without marking it active today', async () => {
        const future = block({ dateRange: { startDate: '2026-09-14', endDate: '2026-10-04' } });
        firestore.getDocs.mockResolvedValue({ docs: [{ id: future.id }] });
        await mockStoredBlocks([future]);
        const service = new IntentBlockService();
        expect((await service.getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10')).blocks).toEqual([]);
        expect((await service.getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10', 20, '2026-09-17')).blocks).toEqual([future]);
    });

    it.each([
        ['2026-09-06', false], ['2026-09-07', true], ['2026-10-04', true], ['2026-10-05', false],
    ])('filters the latest revision by inclusive date range for %s', async (date, active) => {
        const authoredBlock = block({ revision: 2 });
        firestore.getDocs.mockResolvedValue({ docs: [{ id: authoredBlock.id }] });
        await mockStoredBlocks([authoredBlock]);

        const result = await new IntentBlockService().getActiveBlocksWithDiagnostics(USER_ID, date);

        expect(result).toEqual({ blocks: active ? [authoredBlock] : [], unreadableCount: 0, truncated: false });
        expect(firestore.getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: `users/${USER_ID}/intent_blocks/block_1/revisions/2` }));
    });

    it('counts missing, unavailable, and invalid headers and revisions while retaining readable blocks', async () => {
        const ids = ['active', 'header_invalid', 'header_missing', 'header_unavailable', 'revision_invalid', 'revision_missing', 'revision_unavailable'];
        const blocks = ids.map(id => block({ id }));
        firestore.getDocs.mockResolvedValue({ docs: ids.map(id => ({ id })) });
        await mockStoredBlocks(blocks, {
            [`users/${USER_ID}/intent_blocks/header_invalid`]: { userId: 'other-user', blockId: 'header_invalid' },
            [`users/${USER_ID}/intent_blocks/header_missing`]: undefined,
            [`users/${USER_ID}/intent_blocks/header_unavailable`]: new Error('offline'),
            [`users/${USER_ID}/intent_blocks/revision_invalid/revisions/1`]: {
                userId: USER_ID, blockId: 'revision_invalid', revision: 1,
                block: block({ id: 'revision_invalid' }), pinnedTrainingIntentProfile: trainingIntentProfile(),
                sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION, sourceRef: null,
                contentHash: 'tampered', createdAt: '2026-09-01T00:00:00Z',
            },
            [`users/${USER_ID}/intent_blocks/revision_missing/revisions/1`]: undefined,
            [`users/${USER_ID}/intent_blocks/revision_unavailable/revisions/1`]: new Error('offline'),
        });

        const result = await new IntentBlockService().getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10');

        expect(result).toEqual({ blocks: [blocks[0]], unreadableCount: 6, truncated: false });
        expect(firestore.getDoc).toHaveBeenCalledTimes(11);
    });

    it('distinguishes an empty collection from a query outage', async () => {
        const service = new IntentBlockService();
        firestore.getDocs.mockResolvedValueOnce({ docs: [] });
        await expect(service.getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10')).resolves.toEqual({
            blocks: [], unreadableCount: 0, truncated: false,
        });
        const outage = new Error('offline');
        firestore.getDocs.mockRejectedValueOnce(outage);
        await expect(service.getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10')).rejects.toBe(outage);
    });

    it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER])('rejects an invalid bound %s before querying', async maxBlocks => {
        await expect(new IntentBlockService().getActiveBlocksWithDiagnostics(USER_ID, '2026-09-10', maxBlocks)).rejects.toBeInstanceOf(RangeError);
        expect(firestore.getDocs).not.toHaveBeenCalled();
    });
});
