import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    confirmProgressionRevision,
    deterministicActivationKey,
    getCurrentProgressionClaim,
    ProgressionConfirmationError,
    releaseProgressionClaim,
    type ProgressionExperimentActivation,
    type ProgressionExperimentClaim,
} from './progressionClaimService';
import type { IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import { deriveProgressionProposalId } from './progressionProposalIdentity';
import { MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION, type IntentBlockHeader } from './intentBlockService';

const firestore = vi.hoisted(() => ({
    doc: vi.fn((_db, ...pathSegments) => ({ path: pathSegments.join('/') })),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

const mockStageRevision = vi.fn();
const mockHeaderRef = vi.fn((_userId: string, blockId: string) => ({ path: `users/u1/intent_block_headers/${blockId}` }));
const mockRevisionRef = vi.fn((_userId: string, blockId: string, rev: number) => ({ path: `users/u1/intent_block_revisions/${blockId}_${rev}` }));

vi.mock('./intentBlockService', () => ({
    MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION: 'manual-v1',
    IntentBlockService: vi.fn().mockImplementation(function IntentBlockService() {
        return {
            headerRef: mockHeaderRef,
            revisionRef: mockRevisionRef,
            stageRevision: mockStageRevision,
        };
    }),
}));

const USER_ID = 'user_123';
const BLOCK_ID = 'block_abc';
const REVIEW_DATE = '2026-09-21';

function createMockBlock(overrides: Partial<IntentBlock> = {}): IntentBlock {
    return {
        id: BLOCK_ID,
        revision: 1,
        sourcePlanId: BLOCK_ID,
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        objectives: [
            {
                id: 'obj_1',
                sport: 'cycling',
                adaptationScope: 'threshold_quality',
                coverageKey: 'sustained_quality',
                intent: 'develop',
                priority: 'must_have',
                doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
                knowledgeLineage: ['manual-v1'],
                successCriteria: { minCompletedExposures: 3 },
            },
        ],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: REVIEW_DATE },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_1', sessionId: 's1', stepId: 'step1' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
        ...overrides,
    };
}

function createMockProposedChange(overrides: Partial<ProposedProgressionChange> = {}): ProposedProgressionChange {
    return {
        targetBinding: { objectiveId: 'obj_1', sessionId: 's1', stepId: 'step1' },
        variable: 'duration_min',
        unit: 'minutes',
        previousValue: 90,
        proposedValue: 100,
        derivedDoseEffects: { delta: 10 },
        ...overrides,
    };
}

function createHeaderDoc(overrides: Partial<IntentBlockHeader> = {}): IntentBlockHeader {
    return {
        userId: USER_ID,
        blockId: BLOCK_ID,
        revision: 1,
        contentHash: 'hash_123',
        sourcePlanId: BLOCK_ID,
        sourcePlanRevision: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
});

describe('progressionClaimService - helper functions', () => {
    describe('deterministicActivationKey', () => {
        it('generates a 64-character hex string deterministically', async () => {
            const key1 = await deterministicActivationKey('block_a', 'proposal_x');
            const key2 = await deterministicActivationKey('block_a', 'proposal_x');
            const key3 = await deterministicActivationKey('block_b', 'proposal_x');

            expect(key1).toHaveLength(64);
            expect(key1).toBe(key2);
            expect(key1).not.toBe(key3);
        });
    });

    describe('getCurrentProgressionClaim', () => {
        it('returns claim when snapshot exists', async () => {
            const mockClaim: ProgressionExperimentClaim = {
                userId: USER_ID,
                state: 'held',
                experimentId: 'exp_1',
                blockId: BLOCK_ID,
                proposalId: 'prop_1',
                sourcePlanRevision: 1,
                activationKey: 'act_1',
                activationRevisionId: '2',
                acquiredAt: '2026-09-21T00:00:00.000Z',
                revision: 1,
                createdAt: '2026-09-21T00:00:00.000Z',
                updatedAt: '2026-09-21T00:00:00.000Z',
            };

            firestore.getDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => mockClaim,
            });

            const result = await getCurrentProgressionClaim(USER_ID);
            expect(result).toEqual(mockClaim);
        });

        it('returns null when claim snapshot does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => false,
            });

            const result = await getCurrentProgressionClaim(USER_ID);
            expect(result).toBeNull();
        });
    });

    describe('releaseProgressionClaim', () => {
        it('returns released: false if claim does not exist', async () => {
            firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
                const tx = {
                    get: vi.fn().mockResolvedValue({ exists: () => false }),
                };
                return fn(tx);
            });

            const result = await releaseProgressionClaim(USER_ID, 'exp_1');
            expect(result).toEqual({ released: false, reason: 'no claim exists' });
        });

        it('returns released: false if state is released or experimentId mismatches', async () => {
            firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
                const tx = {
                    get: vi.fn().mockResolvedValue({
                        exists: () => true,
                        data: () => ({ state: 'released', experimentId: 'exp_1' }),
                    }),
                };
                return fn(tx);
            });

            const result = await releaseProgressionClaim(USER_ID, 'exp_1');
            expect(result.released).toBe(false);
            expect(result.reason).toContain("claim is 'released'");
        });

        it('updates claim to released when held and matching experimentId', async () => {
            let setCalledWith: unknown = null;
            firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
                const tx = {
                    get: vi.fn().mockResolvedValue({
                        exists: () => true,
                        data: () => ({
                            userId: USER_ID,
                            state: 'held',
                            experimentId: 'exp_1',
                            revision: 1,
                        }),
                    }),
                    set: vi.fn((_ref: unknown, data: unknown) => {
                        setCalledWith = data;
                    }),
                };
                return fn(tx);
            });

            const result = await releaseProgressionClaim(USER_ID, 'exp_1');
            expect(result).toEqual({ released: true });
            expect(setCalledWith).toMatchObject({
                userId: USER_ID,
                state: 'released',
                experimentId: 'exp_1',
                revision: 2,
            });
        });

        it('returns released: false with error message if transaction fails', async () => {
            firestore.runTransaction.mockRejectedValueOnce(new Error('Firestore connection error'));

            const result = await releaseProgressionClaim(USER_ID, 'exp_1');
            expect(result).toEqual({ released: false, reason: 'Firestore connection error' });
        });
    });
});

describe('confirmProgressionRevision - error & boundary conditions', () => {
    const proposedChange = createMockProposedChange();
    const proposalId = deriveProgressionProposalId(1, REVIEW_DATE, proposedChange);

    it('throws invalid-proposed-change when proposalId does not match canonical derived id', async () => {
        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, 'wrong_proposal_id', 1, proposedChange, REVIEW_DATE),
        ).rejects.toThrow(ProgressionConfirmationError);

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, 'wrong_proposal_id', 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'invalid-proposed-change' });
    });

    it('throws block-not-found when block header does not exist', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation(() => {
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'block-not-found' });
    });

    it('throws active_progression_experiment_exists when another experiment claim is currently held', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('progression_experiment_claim')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({
                                state: 'held',
                                blockId: 'other_block',
                                proposalId: 'other_prop',
                            }),
                        });
                    }
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => createHeaderDoc(),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'active_progression_experiment_exists' });
    });

    it('throws stale-source-revision when block header revision differs from expectedSourcePlanRevision', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => createHeaderDoc({ revision: 2 }),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'stale-source-revision' });
    });

    it('throws block-not-found when current block revision doc is missing', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => createHeaderDoc({ revision: 1 }),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'block-not-found' });
    });

    it('throws invalid-proposed-change or review-not-due for invalid review date', async () => {
        // Date outside dateRange
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({ block: createMockBlock() }),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        const outOfRangeDate = '2026-10-15';
        const outOfRangePropId = deriveProgressionProposalId(1, outOfRangeDate, proposedChange);
        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, outOfRangePropId, 1, proposedChange, outOfRangeDate),
        ).rejects.toMatchObject({ code: 'invalid-proposed-change' });

        // Review date before nextReviewDate
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({ block: createMockBlock({ reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-25' } }) }),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        const earlyDate = '2026-09-21';
        const earlyPropId = deriveProgressionProposalId(1, earlyDate, proposedChange);
        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, earlyPropId, 1, proposedChange, earlyDate),
        ).rejects.toMatchObject({ code: 'review-not-due' });
    });

    it('throws no-progression-contract when block lacks progressionContract', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const blockNoContract = createMockBlock({ progressionContract: undefined });
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({ exists: () => true, data: () => ({ block: blockNoContract }) });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'no-progression-contract' });
    });

    it('throws unknown-target-objective when contract target objective is missing from objectives', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const blockMissingObjective = createMockBlock({
                objectives: [],
            });
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({ exists: () => true, data: () => ({ block: blockMissingObjective }) });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'unknown-target-objective' });
    });

    it('throws active-constraint-conflict when a limiting or excluding injury is present', async () => {
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({
                                block: createMockBlock(),
                                pinnedTrainingIntentProfile: { priorities: ['balanced_performance'], weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 } },
                                sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
                            }),
                        });
                    }
                    if (ref.path.includes('trainingSettings')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({
                                userId: USER_ID,
                                injuries: [
                                    {
                                        id: 'inj_1',
                                        type: 'knee',
                                        severity: 'limit',
                                        reviewBy: '2026-09-30',
                                    },
                                ],
                            }),
                        });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'active-constraint-conflict' });
    });
});

describe('confirmProgressionRevision - happy path, idempotency, and concurrent recovery', () => {
    const proposedChange = createMockProposedChange();
    const proposalId = deriveProgressionProposalId(1, REVIEW_DATE, proposedChange);

    it('successfully confirms a new progression revision', async () => {
        const mockNewHeader: IntentBlockHeader = createHeaderDoc({ revision: 2 });
        mockStageRevision.mockReturnValueOnce(mockNewHeader);

        let savedClaim: unknown = null;
        let savedActivation: unknown = null;

        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 1 }) });
                    }
                    if (ref.path.includes('intent_block_revisions')) {
                        return Promise.resolve({
                            exists: () => true,
                            data: () => ({
                                block: createMockBlock(),
                                pinnedTrainingIntentProfile: { priorities: ['balanced_performance'], weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 } },
                                sourceSchemaVersion: MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
                            }),
                        });
                    }
                    if (ref.path.includes('trainingSettings')) {
                        return Promise.resolve({ exists: () => false, data: () => undefined });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
                set: vi.fn((ref: { path: string }, data: unknown) => {
                    if (ref.path.includes('progression_experiment_claim')) {
                        savedClaim = data;
                    }
                    if (ref.path.includes('progression_experiment_activations')) {
                        savedActivation = data;
                    }
                }),
            };
            return fn(tx);
        });

        const result = await confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE);

        expect(result.created).toBe(true);
        expect(result.header.revision).toBe(2);
        expect(result.activation.acceptedSettings.value).toBe(100);
        expect(savedClaim).toMatchObject({ state: 'held', blockId: BLOCK_ID, proposalId });
        expect(savedActivation).toMatchObject({ userId: USER_ID, blockId: BLOCK_ID, proposalId });
    });

    it('handles idempotent confirmation when activation snapshot already exists and matches', async () => {
        const existingActivation: ProgressionExperimentActivation = {
            userId: USER_ID,
            activationKey: 'act_key',
            experimentId: 'act_key',
            blockId: BLOCK_ID,
            proposalId,
            sourcePlanRevision: 1,
            activationRevisionId: '2',
            claimRevision: 1,
            activatedAt: '2026-09-21T00:00:00.000Z',
            priorSettings: { variable: 'duration_min', unit: 'minutes', value: 90 },
            acceptedSettings: { variable: 'duration_min', unit: 'minutes', value: 100 },
        };

        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('progression_experiment_activations')) {
                        return Promise.resolve({ exists: () => true, data: () => existingActivation });
                    }
                    if (ref.path.includes('intent_block_headers')) {
                        return Promise.resolve({ exists: () => true, data: () => createHeaderDoc({ revision: 2 }) });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        const result = await confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE);

        expect(result.created).toBe(false);
        expect(result.header.revision).toBe(2);
        expect(result.activation).toEqual(existingActivation);
    });

    it('throws activation-identity-mismatch when existing activation does not match requested proposal', async () => {
        const mismatchedActivation: ProgressionExperimentActivation = {
            userId: USER_ID,
            activationKey: 'act_key',
            experimentId: 'act_key',
            blockId: BLOCK_ID,
            proposalId: 'different_proposal',
            sourcePlanRevision: 1,
            activationRevisionId: '2',
            claimRevision: 1,
            activatedAt: '2026-09-21T00:00:00.000Z',
            priorSettings: { variable: 'duration_min', unit: 'minutes', value: 90 },
            acceptedSettings: { variable: 'duration_min', unit: 'minutes', value: 100 },
        };

        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => unknown) => {
            const tx = {
                get: vi.fn().mockImplementation((ref: { path: string }) => {
                    if (ref.path.includes('progression_experiment_activations')) {
                        return Promise.resolve({ exists: () => true, data: () => mismatchedActivation });
                    }
                    return Promise.resolve({ exists: () => false, data: () => undefined });
                }),
            };
            return fn(tx);
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toMatchObject({ code: 'activation-identity-mismatch' });
    });

    it('recovers gracefully from transaction contention when direct getDoc confirms a winning concurrent activation', async () => {
        const winningActivation: ProgressionExperimentActivation = {
            userId: USER_ID,
            activationKey: 'act_key',
            experimentId: 'act_key',
            blockId: BLOCK_ID,
            proposalId,
            sourcePlanRevision: 1,
            activationRevisionId: '2',
            claimRevision: 1,
            activatedAt: '2026-09-21T00:00:00.000Z',
            priorSettings: { variable: 'duration_min', unit: 'minutes', value: 90 },
            acceptedSettings: { variable: 'duration_min', unit: 'minutes', value: 100 },
        };

        firestore.runTransaction.mockRejectedValueOnce(new Error('Firebase rules error / contention'));

        firestore.getDoc
            .mockResolvedValueOnce({
                exists: () => true,
                data: () => winningActivation,
            })
            .mockResolvedValueOnce({
                exists: () => true,
                data: () => createHeaderDoc({ revision: 2 }),
            });

        const result = await confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE);

        expect(result.created).toBe(false);
        expect(result.header.revision).toBe(2);
        expect(result.activation).toEqual(winningActivation);
    });

    it('re-throws transaction error if direct getDoc check reveals no activation after transaction failure', async () => {
        const txError = new Error('Transaction aborted');
        firestore.runTransaction.mockRejectedValueOnce(txError);

        firestore.getDoc.mockResolvedValueOnce({
            exists: () => false,
        });

        await expect(
            confirmProgressionRevision(USER_ID, BLOCK_ID, proposalId, 1, proposedChange, REVIEW_DATE),
        ).rejects.toThrow('Transaction aborted');
    });
});
