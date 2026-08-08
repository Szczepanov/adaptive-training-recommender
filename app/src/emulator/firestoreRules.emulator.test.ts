/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-a';
const otherUserId = 'athlete-b';
const recommendationPath = `users/${ownerId}/daily_recommendations/2026-08-07`;

function validRecommendation() {
    return {
        userId: ownerId,
        date: '2026-08-07',
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'A compact rationale.',
        schemaVersion: 3,
        createdAt: '2026-08-07T08:00:00Z',
        updatedAt: '2026-08-07T08:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-08-decision-provenance-v1',
            evaluatedAt: '2026-08-07T08:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-07:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [],
        },
    };
}

emulatorDescribe('Firestore security rules', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows an owner to create a schema-v3 recommendation with a compact audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, recommendationPath), validRecommendation()))).resolves.toBeUndefined();
    });

    it('rejects cross-user recommendation reads', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), validRecommendation());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, recommendationPath)));
    });

    it('rejects client writes to backend-owned wearable collections', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/activities/garmin-1`), { date: '2026-08-07' }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recovery_snapshots/2026-08-07`), { date: '2026-08-07' }));
    });

    it('rejects a recommendation whose user or date disagrees with its path', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), date: '2026-08-08' }));
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), userId: otherUserId }));
        await assertFails(setDoc(
            doc(ownerDb, `users/${otherUserId}/daily_recommendations/2026-08-07`),
            { ...validRecommendation(), userId: otherUserId },
        ));
    });

    it('rejects a v3 recommendation with a malformed audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const malformed = validRecommendation();
        malformed.recommendationAudit.history.sourceStatuses.activities = 'FORGED';
        await assertFails(setDoc(doc(ownerDb, recommendationPath), malformed));
    });

    it('rejects updating decision fields without a batch archive write of the prior revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true }));
    });

    it('rejects decision update when archived prior revision fields are mismatched', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'FORGED_ID',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('rejects decision update with non-incrementing revision number', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 5,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('rejects update or delete of an existing revision document in subcollection', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `${recommendationPath}/revisions/1`), {
                revision: 1, templateId: 'easy_01', templateTitle: 'Easy Ride', category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'r',
            });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${recommendationPath}/revisions/1`), { templateId: 'tampered' }, { merge: true }));
    });

    it('rejects schemaVersion downgrade from 3 to 1', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), schemaVersion: 3 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), schemaVersion: 1 }, { merge: true }));
    });

    it('allows decision update with valid atomic batch archive write', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            templateTitle: 'Hard Ride',
            revision: 2,
        }, { merge: true });

        await expect(assertSucceeds(batch.commit())).resolves.toBeUndefined();
    });
});
