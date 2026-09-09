/**
 * ADR-0037 D-AUTHORITY requires two concurrent confirmations of the same logical proposal
 * to resolve to one activation and one authored revision. Keep this as a focused real-
 * emulator race so sequential retry coverage cannot accidentally substitute for the actual
 * serialization property.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import type { IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import { IntentBlockService } from '../services/intentBlockService';
import { deriveProgressionProposalId } from '../services/progressionProposalIdentity';
import { confirmProgressionRevision } from '../services/progressionClaimService';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const REVIEW_DATE = '2026-09-15';

function block(): IntentBlock {
    return {
        id: 'block-race',
        revision: 1,
        sourcePlanId: 'block-race',
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
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: REVIEW_DATE },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_1' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 150 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
    };
}

const proposedChange: ProposedProgressionChange = {
    targetBinding: { objectiveId: 'obj_1' },
    variable: 'duration_min',
    unit: 'minutes',
    previousValue: 90,
    proposedValue: 100,
    derivedDoseEffects: { delta: 10 },
};

emulatorDescribe('concurrent identical H5c confirmation', () => {
    let testEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-h5c-same-proposal-race',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('serializes two tabs to one activation and one authored revision', async () => {
        const userId = 'athlete-same-proposal-race';
        const db = testEnvironment.authenticatedContext(userId).firestore() as unknown as Firestore;
        const { doc, setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', userId, 'training_intent', 'profile'), {
            userId,
            planningMode: 'evergreen',
            priorities: ['balanced_performance'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
            organizationPreference: 'auto',
            schemaVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });
        const service = new IntentBlockService(db);
        await service.save(userId, block());

        const proposalId = deriveProgressionProposalId(1, REVIEW_DATE, proposedChange);
        const [left, right] = await Promise.all([
            confirmProgressionRevision(userId, 'block-race', proposalId, 1, proposedChange, REVIEW_DATE, db),
            confirmProgressionRevision(userId, 'block-race', proposalId, 1, proposedChange, REVIEW_DATE, db),
        ]);

        expect(left.activation.activationKey).toBe(right.activation.activationKey);
        expect([left.created, right.created].sort()).toEqual([false, true]);
        expect(left.activation.activationRevisionId).toBe('2');
        expect(right.activation.activationRevisionId).toBe('2');

        const headerState = await service.getHeaderState(userId, 'block-race');
        expect(headerState.status).toBe('AVAILABLE');
        if (headerState.status === 'AVAILABLE') {
            expect(headerState.data.revision).toBe(2);
        }
    });
});
