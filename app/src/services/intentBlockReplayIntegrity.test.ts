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
vi.mock('./trainingIntentProfileService', () => ({
    trainingIntentProfileService: { getProfileState: vi.fn() },
    TrainingIntentProfileService: vi.fn(),
}));

import type { IntentBlock } from '../engine/blockIntent';
import {
    buildTreatmentIntentReplayPayloadV1,
    hashTreatmentIntentReplayPayload,
    type PinnedTrainingIntentProfileSnapshot,
} from '../engine/blockIntentReplay';
import {
    IntentBlockService,
    MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
    type IntentBlockRevisionDocument,
} from './intentBlockService';

const USER_ID = 'u-replay';
const pinnedProfile: PinnedTrainingIntentProfileSnapshot = {
    priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    schemaVersion: 1,
};

function block(): IntentBlock {
    return {
        id: 'block_1',
        revision: 1,
        sourcePlanId: 'block_1',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
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
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-15' },
    };
}

async function validRevision(): Promise<IntentBlockRevisionDocument> {
    const intentBlock = block();
    const payload = buildTreatmentIntentReplayPayloadV1(
        intentBlock,
        { ...pinnedProfile, priorities: [...pinnedProfile.priorities] },
        MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
    );
    const contentHash = await hashTreatmentIntentReplayPayload(payload);
    return {
        userId: USER_ID,
        blockId: intentBlock.id,
        revision: intentBlock.revision,
        block: intentBlock,
        pinnedTrainingIntentProfile: pinnedProfile,
        sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
        sourceRef: null,
        contentHash,
        createdAt: '2026-09-01T00:00:00.000Z',
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('IntentBlockService replay integrity', () => {
    it('returns AVAILABLE when the frozen replay payload hashes to the stored identity', async () => {
        const revision = await validRevision();
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => revision });

        const state = await new IntentBlockService().getRevisionState(USER_ID, 'block_1', 1);
        expect(state.status).toBe('AVAILABLE');
    });

    it('returns INVALID when contentHash no longer matches the frozen replay payload', async () => {
        const revision = await validRevision();
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...revision, contentHash: '0'.repeat(64) }),
        });

        const state = await new IntentBlockService().getRevisionState(USER_ID, 'block_1', 1);
        expect(state.status).toBe('INVALID');
        if (state.status === 'INVALID') {
            expect(state.issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'content-hash-mismatch', field: 'contentHash' }),
            ]));
        }
    });

    it('returns INVALID when frozen profile provenance cannot build a replay payload', async () => {
        const revision = await validRevision();
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...revision, pinnedTrainingIntentProfile: {} }),
        });

        const state = await new IntentBlockService().getRevisionState(USER_ID, 'block_1', 1);
        expect(state.status).toBe('INVALID');
        if (state.status === 'INVALID') {
            expect(state.issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'invalid-replay-provenance' }),
            ]));
        }
    });
});
