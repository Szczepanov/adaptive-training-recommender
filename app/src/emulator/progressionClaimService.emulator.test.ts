/**
 * ADR-0037 D-AUTHORITY (H5c): confirmation/release against real Firestore transactions
 * and the real rules. These tests cover serialization as well as mutation-boundary
 * revalidation; mocked transactions cannot prove either property.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { IntentBlockService } from '../services/intentBlockService';
import { createDefaultTrainingSettings } from '../services/trainingSettingsService';
import { deriveProgressionProposalId } from '../services/progressionProposalIdentity';
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
const FIRST_REVIEW_DATE = '2026-09-15';

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
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: FIRST_REVIEW_DATE },
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

function proposalId(
    sourceRevision: number,
    reviewDate: string,
    proposedChange: ProposedProgressionChange,
): string {
    return deriveProgressionProposalId(sourceRevision, reviewDate, proposedChange);
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
        const proposedChange = change();
        const id = proposalId(1, FIRST_REVIEW_DATE, proposedChange);

        const results = await Promise.allSettled([
            confirmProgressionRevision(userId, 'block-a', id, 1, proposedChange, FIRST_REVIEW_DATE, db),
            confirmProgressionRevision(userId, 'block-b', id, 1, proposedChange, FIRST_REVIEW_DATE, db),
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
        const userId = 'athlete-same-proposal';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-solo');
        const proposedChange = change();
        const id = proposalId(1, FIRST_REVIEW_DATE, proposedChange);

        const first = await confirmProgressionRevision(userId, 'block-solo', id, 1, proposedChange, FIRST_REVIEW_DATE, db);
        const second = await confirmProgressionRevision(userId, 'block-solo', id, 1, proposedChange, FIRST_REVIEW_DATE, db);

        expect(first.activation.activationKey).toBe(second.activation.activationKey);
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);

        const service = new IntentBlockService(db);
        const headerState = await service.getHeaderState(userId, 'block-solo');
        expect(headerState.status).toBe('AVAILABLE');
        if (headerState.status === 'AVAILABLE') expect(headerState.data.revision).toBe(2);
    });

    it('rejects reuse of a canonical proposal id with a different before/after payload', async () => {
        const userId = 'athlete-idempotency-payload';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-payload');
        const firstChange = change();
        const firstId = proposalId(1, FIRST_REVIEW_DATE, firstChange);

        await confirmProgressionRevision(userId, 'block-payload', firstId, 1, firstChange, FIRST_REVIEW_DATE, db);
        await expect(confirmProgressionRevision(
            userId,
            'block-payload',
            firstId,
            1,
            change({ proposedValue: 110, derivedDoseEffects: { delta: 20 } }),
            FIRST_REVIEW_DATE,
            db,
        )).rejects.toMatchObject({ code: 'invalid-proposed-change' });
    });

    it('rejects an arbitrary jump even when the caller supplies internally-consistent numbers', async () => {
        const userId = 'athlete-arbitrary-jump';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-jump');
        const proposedChange = change({ proposedValue: 130, derivedDoseEffects: { delta: 40 } });

        await expect(confirmProgressionRevision(
            userId,
            'block-jump',
            proposalId(1, FIRST_REVIEW_DATE, proposedChange),
            1,
            proposedChange,
            FIRST_REVIEW_DATE,
            db,
        )).rejects.toMatchObject({ code: 'invalid-proposed-change' });

        expect(await getCurrentProgressionClaim(userId, db)).toBeNull();
        const service = new IntentBlockService(db);
        const headerState = await service.getHeaderState(userId, 'block-jump');
        expect(headerState.status).toBe('AVAILABLE');
        if (headerState.status === 'AVAILABLE') expect(headerState.data.revision).toBe(1);
    });

    it('rejects a mismatched target binding instead of applying its value to the real contract', async () => {
        const userId = 'athlete-wrong-binding';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-binding');
        const proposedChange = change({ targetBinding: { objectiveId: 'different-objective' } });

        await expect(confirmProgressionRevision(
            userId,
            'block-binding',
            proposalId(1, FIRST_REVIEW_DATE, proposedChange),
            1,
            proposedChange,
            FIRST_REVIEW_DATE,
            db,
        )).rejects.toMatchObject({ code: 'invalid-proposed-change' });
        expect(await getCurrentProgressionClaim(userId, db)).toBeNull();
    });

    it('rejects confirmation before the block review is due', async () => {
        const userId = 'athlete-review-not-due';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-early');
        const reviewDate = '2026-09-14';
        const proposedChange = change();

        await expect(confirmProgressionRevision(
            userId,
            'block-early',
            proposalId(1, reviewDate, proposedChange),
            1,
            proposedChange,
            reviewDate,
            db,
        )).rejects.toMatchObject({ code: 'review-not-due' });
        expect(await getCurrentProgressionClaim(userId, db)).toBeNull();
    });

    it('rechecks current injury restrictions and blocks an increase if a new limit/exclude restriction is active', async () => {
        const userId = 'athlete-new-restriction';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-restriction');
        const { setDoc, doc } = await import('firebase/firestore');
        const settings = createDefaultTrainingSettings(userId, '2026-09-15T08:00:00.000Z');
        await setDoc(doc(db, 'users', userId, 'trainingSettings', 'profile'), {
            ...settings,
            injuries: [{ severity: 'limit', region: 'knee', reviewBy: '2026-10-01' }],
        });
        const proposedChange = change();

        await expect(confirmProgressionRevision(
            userId,
            'block-restriction',
            proposalId(1, FIRST_REVIEW_DATE, proposedChange),
            1,
            proposedChange,
            FIRST_REVIEW_DATE,
            db,
        )).rejects.toMatchObject({ code: 'active-constraint-conflict' });
        expect(await getCurrentProgressionClaim(userId, db)).toBeNull();
    });

    it('still allows a bounded reduction when a new restrictive injury constraint is active', async () => {
        const userId = 'athlete-reduction-under-restriction';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-reduction');
        const { setDoc, doc } = await import('firebase/firestore');
        const settings = createDefaultTrainingSettings(userId, '2026-09-15T08:00:00.000Z');
        await setDoc(doc(db, 'users', userId, 'trainingSettings', 'profile'), {
            ...settings,
            injuries: [{ severity: 'exclude', region: 'knee', reviewBy: '2026-10-01' }],
        });
        const proposedChange = change({ proposedValue: 80, derivedDoseEffects: { delta: -10 } });

        const reduced = await confirmProgressionRevision(
            userId,
            'block-reduction',
            proposalId(1, FIRST_REVIEW_DATE, proposedChange),
            1,
            proposedChange,
            FIRST_REVIEW_DATE,
            db,
        );
        expect(reduced.created).toBe(true);
        expect(reduced.activation.acceptedSettings.value).toBe(80);
    });

    it('advances the review cadence from the actual review date and carries the frozen source profile/provenance', async () => {
        const userId = 'athlete-cadence';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-cadence');
        const service = new IntentBlockService(db);
        const sourceState = await service.getRevisionState(userId, 'block-cadence', 1);
        expect(sourceState.status).toBe('AVAILABLE');
        const reviewDate = '2026-09-17';
        const proposedChange = change();

        const confirmation = await confirmProgressionRevision(
            userId,
            'block-cadence',
            proposalId(1, reviewDate, proposedChange),
            1,
            proposedChange,
            reviewDate,
            db,
        );
        expect(confirmation.activation.activationRevisionId).toBe('2');

        const acceptedState = await service.getRevisionState(userId, 'block-cadence', 2);
        expect(acceptedState.status).toBe('AVAILABLE');
        if (sourceState.status === 'AVAILABLE' && acceptedState.status === 'AVAILABLE') {
            expect(acceptedState.data.block.reviewSchedule.nextReviewDate).toBe('2026-09-30');
            expect(acceptedState.data.pinnedTrainingIntentProfile).toEqual(sourceState.data.pinnedTrainingIntentProfile);
            expect(acceptedState.data.sourceSchemaVersion).toBe(sourceState.data.sourceSchemaVersion);
            expect(acceptedState.data.sourceRef).toBe(sourceState.data.sourceRef);
        }
    });

    it('rejects a stale source revision with zero claim/activation/plan writes', async () => {
        const userId = 'athlete-stale-source';
        const db = ownerDb(userId);
        await seedProfileAndBlock(db, userId, 'block-stale');

        const service = new IntentBlockService(db);
        await service.save(userId, block('block-stale', 95, 2));
        const proposedChange = change();

        await expect(confirmProgressionRevision(
            userId,
            'block-stale',
            proposalId(1, FIRST_REVIEW_DATE, proposedChange),
            1,
            proposedChange,
            FIRST_REVIEW_DATE,
            db,
        )).rejects.toMatchObject({ code: 'stale-source-revision' });

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
        const firstChange = change();

        const first = await confirmProgressionRevision(
            userId,
            'block-release',
            proposalId(1, FIRST_REVIEW_DATE, firstChange),
            1,
            firstChange,
            FIRST_REVIEW_DATE,
            db,
        );
        await releaseProgressionClaim(userId, first.activation.experimentId, db);

        const service = new IntentBlockService(db);
        const headerAfterFirst = await service.getHeaderState(userId, 'block-release');
        const revisionAfterFirst = headerAfterFirst.status === 'AVAILABLE' ? headerAfterFirst.data.revision : 2;
        const secondReviewDate = '2026-09-29';
        const secondChange = change({ previousValue: 100, proposedValue: 110 });
        const second = await confirmProgressionRevision(
            userId,
            'block-release',
            proposalId(revisionAfterFirst, secondReviewDate, secondChange),
            revisionAfterFirst,
            secondChange,
            secondReviewDate,
            db,
        );

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
