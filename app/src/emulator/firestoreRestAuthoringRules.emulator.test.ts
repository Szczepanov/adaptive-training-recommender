/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-rest-rules';
const revisionPath = `users/${ownerId}/external_plans/autumn-block/revisions/1`;
const recommendationPath = `users/${ownerId}/daily_recommendations/2026-08-21`;

function validExternalPlanRevisionV3(restDays: unknown[] = [{ id: 'w1-fri-rest', week: 1, day: 'friday' }]) {
    return {
        schema: 'adaptive-training-recommender/external-plan@3',
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: [{ id: 'w1-a', title: 'Threshold', priority: 'key' }],
        restDays,
    };
}

function validRecommendation() {
    return {
        userId: ownerId,
        date: '2026-08-21',
        templateId: 'rest_01',
        templateTitle: 'Rest',
        category: 'Rest',
        modality: 'None',
        mode: 'train',
        rationale: 'Protected rest authored by the external plan.',
        schemaVersion: 3,
        createdAt: '2026-08-21T06:00:00Z',
        updatedAt: '2026-08-21T06:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-09-authored-rest-day-v1',
            evaluatedAt: '2026-08-21T06:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-21:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [] as unknown[],
            externalRest: {
                planId: 'autumn-block', revision: 1, contentHash: 'a'.repeat(64),
                restDirectiveId: 'w1-fri-rest', date: '2026-08-21',
            },
        } as Record<string, unknown>,
    };
}

emulatorDescribe('Firestore rules — ADR-0035 authored rest', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-rest-rules',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('accepts a valid external-plan@3 rest directive', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, revisionPath), validExternalPlanRevisionV3()))).resolves.toBeUndefined();
    });

    it('rejects malformed rest directive elements at the storage boundary', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        for (const restDays of [
            [null],
            [{ id: 'missing-week-day' }],
            [{ id: 'bad-week', week: 0, day: 'friday' }],
            [{ id: 'bad-day', week: 1, day: 'holiday' }],
            [{ id: 'extra-field', week: 1, day: 'friday', reason: 'taper' }],
        ]) {
            await assertFails(setDoc(doc(ownerDb, revisionPath), validExternalPlanRevisionV3(restDays)));
        }
    });

    it('binds externalRest provenance to canonical rest_01', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), validRecommendation()));

        await testEnvironment.clearFirestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), templateId: 'easy_01' }));
    });

    it('rejects an authored-rest audit that also claims externalPlan provenance', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const recommendation = validRecommendation();
        recommendation.recommendationAudit.externalPlan = {
            planId: 'autumn-block', revision: 1, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64),
        };
        await assertFails(setDoc(doc(ownerDb, recommendationPath), recommendation));
    });

    it('rejects ranked candidates on an authored-rest audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const recommendation = validRecommendation();
        recommendation.recommendationAudit.candidateScores = [{ templateId: 'easy_01', utilityScore: 1, excludedReasons: [] }];
        await assertFails(setDoc(doc(ownerDb, recommendationPath), recommendation));
    });
});
