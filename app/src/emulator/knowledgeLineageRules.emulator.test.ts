import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'knowledge-lineage-owner';
const date = '2026-08-31';
const recommendationPath = `users/${ownerId}/daily_recommendations/${date}`;

function validV4Recommendation(knowledgeLineage: Array<{ claimId: string; version: number }> = []) {
    return {
        userId: ownerId,
        date,
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'A compact rationale.',
        schemaVersion: 4,
        revision: 1,
        createdAt: '2026-08-31T06:00:00Z',
        updatedAt: '2026-08-31T06:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-08-skr1-persisted-knowledge-lineage-v1',
            evaluatedAt: '2026-08-31T06:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-31:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: {
                    activities: 'AVAILABLE',
                    recommendations: 'AVAILABLE',
                    manualTraining: 'MISSING',
                },
            },
            envelope: {
                safetyRestrictedModalityCount: 0,
                planMaxAllowableTier: 'Easy',
            },
            candidateScores: [],
            knowledgeLineage,
        },
    };
}

emulatorDescribe('Firestore v4 recommendation knowledge lineage', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-knowledge-lineage',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows an owner to create a v4 recommendation with compact lineage', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(
            doc(ownerDb, recommendationPath),
            validV4Recommendation([{ claimId: 'readiness.objective_mode_thresholds', version: 1 }]),
        ))).resolves.toBeUndefined();
    });

    it('rejects schema v4 when knowledge lineage is omitted', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const recommendation = validV4Recommendation();
        const auditWithoutLineage: Record<string, unknown> = { ...recommendation.recommendationAudit };
        delete auditWithoutLineage.knowledgeLineage;
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            ...recommendation,
            recommendationAudit: auditWithoutLineage,
        }));
    });

    it('rejects lineage beyond the persisted 64-reference bound', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const lineage = Array.from({ length: 65 }, (_, index) => ({
            claimId: `claim.${index}`,
            version: 1,
        }));
        await assertFails(setDoc(doc(ownerDb, recommendationPath), validV4Recommendation(lineage)));
    });

    it('rejects malformed lineage refs at the Firestore boundary', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const recommendation = validV4Recommendation();
        const malformedAudit = {
            ...recommendation.recommendationAudit,
            knowledgeLineage: [{ claimId: 'readiness.objective_mode_thresholds' }],
        };
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            ...recommendation,
            recommendationAudit: malformedAudit,
        }));
    });

    it('rejects duplicate claim ids even when versions differ', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(
            doc(ownerDb, recommendationPath),
            validV4Recommendation([
                { claimId: 'readiness.objective_mode_thresholds', version: 1 },
                { claimId: 'readiness.objective_mode_thresholds', version: 2 },
            ]),
        ));
    });

    it('rejects mutating an audit when decision fields and revision are unchanged', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const original = validV4Recommendation([{ claimId: 'readiness.objective_mode_thresholds', version: 1 }]);
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), original));

        const mutated = validV4Recommendation([{ claimId: 'readiness.objective_mode_thresholds', version: 2 }]);
        mutated.updatedAt = '2026-08-31T07:00:00Z';
        await assertFails(setDoc(doc(ownerDb, recommendationPath), mutated));
    });
});
