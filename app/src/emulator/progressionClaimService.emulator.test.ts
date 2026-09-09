/**
 * ADR-0037 D-AUTHORITY (H5c), Phase C: `confirmProgressionRevision`/`releaseProgressionClaim`
 * exercised against the real emulator with the real security rules.
 *
 * A mocked-transaction unit test cannot prove any of what matters here -- exactly the same
 * reasoning `intradayLaunchClaim.emulator.test.ts` gives for its own real-emulator suite.
 * The properties under test are products of Firestore's actual commit protocol: that two
 * confirmations for *different* proposals against the same athlete's claim serialize to
 * exactly one winner, that two confirmations for the *identical* proposal resolve to one
 * activation, and that the `revision == resource.data.revision + 1` rule on the claim
 * document is what makes any of this true rather than an application-level convention a
 * mock would happily let slide.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { IntentBlockService } from '../services/intentBlockService';
import {
    confirmProgressionRevision,
    releaseProgressionClaim,
    getCurrentProgressionClaim,
    deterministicActivationKey,
    ProgressionConfirmationError,
} from '../services/progressionClaimService';
import type { IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

function block(blockId: string, currentValue = 90, revision = 1): IntentBlock {
    return {
        id: blockId,
        revision,
        sourcePlanId: blockId,
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        objectives: [{
            id: 'obj_1',
            sport: 'cycling',
            adaptationScope: 'threshold_quality',
            coverageKey: 'sustained_quality',
            intent: 'develop',
            priority: 'must_have',
            doseEnvelope: { min: 60, target: 90, max: 150, unit: 'minutes', floorSemantics: 'hard_floor' },
            knowledgeLineage: ['athlete-authored-manual-v1'],
            successCriteria: { minCompletedExposures: 3 },
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-15' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_1' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue,
            permittedRange: { min: 60, max: 150 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
        title: 'Cycling Build',
    };
}

function change(overrides: Partial<ProposedProgressionChange> = {}): ProposedProgressionChange {
    return {
        targetBinding: { objectiveId: 'obj_1' },
        variable: 'duration_min',
        unit: 'minutes',
        previousValue: 90,
        proposedValue: 100,
        derivedDoseEffects: { delta: 10 },
        ...overrides,
    };
}

emulatorDescribe('confirmProgressionRevision / releaseProgressionClaim (real transactions, real rules)', () => {
    let testEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-h5c-progression-claim',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    function ownerDb(userId: string): Firestore {
        return testEnvironment.authenticatedContext(userId).firestore() as unknown as Firestore;
    }

    async function seedProfileAndBlock(db: Firestore, userId: string, blockId: string): Promise<void> {
        const { setDoc, doc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', userId, 'training_intent', 'profile'), {
            userId, planningMode: 'evergreen', priorities: ['balanced_performance'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
            organizationPreference: 'auto', schemaVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        });
        const service = new IntentBlockService(db);
        await service.save(userId, block(blockId));
    }

    it('lets exactly one of two concurrent confirmations for DIFFERENT proposals win the athlete-scoped claim', async () => {
        const userId = 'athlete-two-proposals';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-a');
        await seedProfileAndBlock(db, userId, 'block-b');

        const results = await Promise.allSettled([
            confirmProgressionRevision(userId, 'block-a', 'proposal-a', 1, change(), db),
            confirmProgressionRevision(userId, 'block-b', 'proposal-b', 1, change(), db),
        ]);

        const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmProgressionRevision>>> => r.status === 'fulfilled');
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(ProgressionConfirmationError);
        expect((rejected[0].reason as ProgressionConfirmationError).code).toBe('active_progression_experiment_exists');

        const claim = await getCurrentProgressionClaim(userId, db);
        expect(claim?.state).toBe('held');
        expect(claim?.blockId).toBe(fulfilled[0].value.activation.blockId);
    });

    it('resolves a repeated confirmation of the IDENTICAL proposal to the same activation without a second authored revision', async () => {
        // Sequential, not concurrent: this proves the idempotent-replay branch itself
        // (activation-by-reference short-circuits before any write). Genuine concurrent
        // contention for the athlete-scoped claim is already proven above for two
        // *different* proposals -- the case ADR-0037 is actually worried about (a second
        // experiment stealing the singleton), and the one a mocked test cannot prove.
        const userId = 'athlete-same-proposal';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-solo');

        const first = await confirmProgressionRevision(userId, 'block-solo', 'proposal-solo', 1, change(), db);
        const second = await confirmProgressionRevision(userId, 'block-solo', 'proposal-solo', 1, change(), db);

        expect(first.activation.activationKey).toBe(second.activation.activationKey);
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);

        const service = new IntentBlockService(db);
        const headerState = await service.getHeaderState(userId, 'block-solo');
        expect(headerState.status).toBe('AVAILABLE');
        if (headerState.status === 'AVAILABLE') expect(headerState.data.revision).toBe(2);
    });

    it('rejects a stale source revision with zero claim/activation/plan writes', async () => {
        const userId = 'athlete-stale-source';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-stale');

        // The block moved to revision 2 (e.g. a direct edit) after the review that produced
        // this proposedChange observed revision 1.
        const service = new IntentBlockService(db);
        await service.save(userId, block('block-stale', 95, 2));

        await expect(confirmProgressionRevision(userId, 'block-stale', 'proposal-stale', 1, change(), db))
            .rejects.toMatchObject({ code: 'stale-source-revision' });

        const claim = await getCurrentProgressionClaim(userId, db);
        expect(claim).toBeNull();
        const headerState = await service.getHeaderState(userId, 'block-stale');
        expect(headerState.status).toBe('AVAILABLE');
        if (headerState.status === 'AVAILABLE') expect(headerState.data.revision).toBe(2);
    });

    it('does not let a stale release clear a newer claim it does not own (compare-and-clear)', async () => {
        const userId = 'athlete-compare-and-clear';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-release');

        const first = await confirmProgressionRevision(userId, 'block-release', 'proposal-1', 1, change(), db);
        await releaseProgressionClaim(userId, first.activation.experimentId, db);

        // A second, later experiment now holds the claim.
        const service = new IntentBlockService(db);
        const headerAfterFirst = await service.getHeaderState(userId, 'block-release');
        const revisionAfterFirst = headerAfterFirst.status === 'AVAILABLE' ? headerAfterFirst.data.revision : 2;
        const second = await confirmProgressionRevision(userId, 'block-release', 'proposal-2', revisionAfterFirst, change({ previousValue: 100, proposedValue: 110 }), db);

        // A delayed release for the FIRST (already-released, terminal) experiment must not
        // touch the second's now-held claim.
        const staleRelease = await releaseProgressionClaim(userId, first.activation.experimentId, db);
        expect(staleRelease.released).toBe(false);

        const claim = await getCurrentProgressionClaim(userId, db);
        expect(claim?.state).toBe('held');
        expect(claim?.experimentId).toBe(second.activation.experimentId);
    });

    it('produces the same deterministic activation key for the same (blockId, proposalId) every time', async () => {
        const a = await deterministicActivationKey('block-x', 'proposal-y');
        const b = await deterministicActivationKey('block-x', 'proposal-y');
        const c = await deterministicActivationKey('block-x', 'proposal-z');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
});
