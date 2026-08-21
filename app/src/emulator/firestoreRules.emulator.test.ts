/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-a';
const otherUserId = 'athlete-b';
const recommendationPath = `users/${ownerId}/daily_recommendations/2026-08-07`;
const fixedActivityPath = `users/${ownerId}/fixed_activities/activity-1`;
const planBlockPath = `users/${ownerId}/plan_blocks/trip-august`;
const trainingIntentProfilePath = `users/${ownerId}/training_intent/profile`;
const preferencesPath = `users/${ownerId}/preferences/profile`;
const goalPath = `users/${ownerId}/goals/goal-1`;
const externalPlanPath = `users/${ownerId}/external_plans/autumn-block`;
const externalRevisionPath = `${externalPlanPath}/revisions/1`;
const externalPlacementPath = `${externalPlanPath}/placement/current`;
const decisionJournalPath = `users/${ownerId}/decision_journal/2026-08-07`;
const checkinPath = `users/${ownerId}/daily_subjective_checkins/2026-08-18`;

function validExternalPlanHeader() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        contentHash: 'a'.repeat(64),
        importedAt: '2026-08-15T06:00:00Z', supersededFrom: null, updatedAt: '2026-08-15T06:00:00Z',
    };
}

function validExternalPlanRevision() {
    return {
        schema: 'adaptive-training-recommender/external-plan@1',
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: [{ id: 'w1-a', title: 'Threshold', priority: 'key' }],
    };
}

function validExternalPlacement() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1,
        assignments: [{ sessionId: 'w1-a', date: '2026-08-18', status: 'planned' }],
        updatedAt: '2026-08-15T06:00:00Z',
    };
}

function validGoal() {
    return {
        userId: ownerId, title: 'Road race', targetDate: '2026-09-13', eventCategory: 'cycling_event',
        taper: { startDate: '2026-09-07' }, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validFixedActivity() {
    return {
        userId: ownerId,
        title: 'Evening Football',
        date: '2026-08-12',
        durationMin: 90,
        fixed: true,
        environment: 'outdoor',
        equipment: ['cleats'],
        expectedStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.4 },
        expectedCost: { systemic: 0.8, lowerBody: 0.5 },
        isCompleted: false,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validPlanBlock() {
    return {
        userId: ownerId, eventId: 'road-race', phase: 'travel', startDate: '2026-08-19', endDate: '2026-08-22',
        volumeScale: 0.6, intensityScale: 0.5,
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validTrainingIntentProfile() {
    return {
        userId: ownerId, planningMode: 'evergreen', priorities: ['health'],
        weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
        organizationPreference: 'auto', schemaVersion: 1,
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validPreferences() {
    return {
        userId: ownerId, unavailableModalities: ['Cycling'],
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validDecisionJournalEntry() {
    return {
        userId: ownerId, date: '2026-08-07',
        externalVerdict: 'proceed', sawEngineVerdictFirst: false,
        createdAt: '2026-08-07T06:00:00Z', updatedAt: '2026-08-07T06:00:00Z',
        schemaVersion: 1,
    };
}

function validCheckinWithSessionResponse() {
    return {
        userId: ownerId,
        date: '2026-08-18',
        readiness: 6,
        sleepQuality: 6,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        motivation: 6,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 45, preferredModalityToday: null, indoorOnly: false },
        tissueResponses: {
            knee: {
                region: 'knee',
                morningState: 'normal',
                nextMorningReaction: 'normal',
                sourceSessionRef: { kind: 'strength', id: 'session-1', date: '2026-08-17' },
            },
        },
        createdAt: '2026-08-18T06:00:00Z',
        updatedAt: '2026-08-18T06:00:00Z',
    };
}

function validStrengthSession() {
    return {
        userId: ownerId, sessionId: 'session-1', date: '2026-08-17',
        startedAt: '2026-08-17T18:00:00Z', updatedAt: '2026-08-17T18:00:00Z',
        state: 'in_progress',
        // Rules bound array length and top-level shape only (S1.3): nested per-set fields
        // like weightKg/reps/gauge are not, and cannot be, validated element-wise here --
        // see the comment on hasValidStrengthSession. Emulator coverage below reflects that.
        exercises: [{ exerciseId: 'hang_power_clean', sets: [{ setIndex: 1, reps: 3, weightKg: 80, isWarmup: false, completedAt: '2026-08-17T18:02:00Z' }] }],
        schemaVersion: 1,
    };
}

function validRecommendation(auditEvaluatedAt = '2026-08-07T08:00:00Z') {
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
            evaluatedAt: auditEvaluatedAt,
            decisionContextRevision: 'history-v1:2026-08-07:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [] as unknown[],
        } as Record<string, unknown>,
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

    it('accepts a valid exact engine verdict and rejects an unsupported one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), engineVerdict: 'advisory' }));
        await testEnvironment.clearFirestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), engineVerdict: 'maybe' }));
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

    it('allows an owner to record a canonical check-in response linked to a strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, checkinPath), validCheckinWithSessionResponse()));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, checkinPath), validCheckinWithSessionResponse(), { merge: true }));
    });

    it('allows a well-formed goal taper and rejects a malformed taper object', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, goalPath), validGoal()));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-bad`), { ...validGoal(), taper: { startDate: 123 } }));
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

    it('accepts an audit carrying external plan provenance, and rejects a malformed one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const external = validRecommendation();
        external.recommendationAudit.externalPlan = {
            planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64),
        };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), external));

        for (const broken of [
            { planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold' },
            { planId: 'autumn-block', revision: 0, sessionId: 'w1-threshold', contentHash: 'abc' },
            { planId: 'autumn-block', revision: '2', sessionId: 'w1-threshold', contentHash: 'abc' },
            { planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'abc', extra: true },
        ]) {
            const malformed = validRecommendation();
            malformed.recommendationAudit.externalPlan = broken;
            await assertFails(setDoc(doc(ownerDb, `${recommendationPath}`), malformed));
        }
    });

    it('accepts an audit carrying subjective-drift provenance, and rejects a malformed one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withDrift = validRecommendation();
        withDrift.recommendationAudit.subjectiveDrift = {
            estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
            estimatorPolicyVersion: 'subjective-drift-score-v1-equal-weights-strain-z-cap',
            historyThroughDateExclusive: '2026-08-07',
            recentRecordedDays: 7,
            longRecordedDays: 28,
            contribution: 1.2,
            perMetricContributions: { readiness: 0.2, sleepQuality: 0.2, fatigue: 0.2, soreness: 0.2, mentalStress: 0.2, motivation: 0.2 },
            decisionRelevant: true,
        };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), withDrift));

        const validDrift = withDrift.recommendationAudit.subjectiveDrift as Record<string, unknown>;
        for (const broken of [
            { ...validDrift, estimatorId: '' },
            { ...validDrift, estimatorPolicyVersion: '' },
            { ...validDrift, recentRecordedDays: -1 },
            { ...validDrift, contribution: -0.5 },
            { ...validDrift, decisionRelevant: 'yes' },
            { ...validDrift, perMetricContributions: { readiness: 0.2 } },
            { ...validDrift, extra: true },
        ]) {
            const malformed = validRecommendation();
            malformed.recommendationAudit.subjectiveDrift = broken;
            await assertFails(setDoc(doc(ownerDb, recommendationPath), malformed));
        }
    });

    it('rejects a v3 recommendation with a malformed audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const malformed = validRecommendation();
        (malformed.recommendationAudit.history as { sourceStatuses: Record<string, string> }).sourceStatuses.activities = 'FORGED';
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

    it('rejects adding a prescription without incrementing the revision and archiving the prior decision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            prescription: { workoutId: 'easy_ride', displayBlocks: [] },
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

    it('allows decision update with valid atomic batch archive write and a genuinely new audit', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation('2026-08-07T08:00:00Z'), revision: 1 });
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
            recommendationAudit: validRecommendation('2026-08-07T08:00:00Z').recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation('2026-08-07T09:30:00Z'),
            templateId: 'hard_01',
            templateTitle: 'Hard Ride',
            revision: 2,
        }, { merge: true });

        await expect(assertSucceeds(batch.commit())).resolves.toBeUndefined();
    });

    it('allows re-saving the same decision later with the original audit preserved unchanged', async () => {
        const original = validRecommendation('2026-08-07T08:00:00Z');
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...original, revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(
            setDoc(doc(ownerDb, recommendationPath), { ...original, revision: 1 }, { merge: true }),
        )).resolves.toBeUndefined();
    });

    it('allows an adherence-only merge on a revisioned v3 recommendation with nested decision evidence', async () => {
        const original = {
            ...validRecommendation('2026-08-07T08:00:00Z'),
            revision: 1,
            prescription: {
                id: '2026-08-07_easy_ride_default',
                workoutId: 'easy_ride',
                displayBlocks: [{ id: 'main', steps: [{ id: 'easy', targets: ['RPE 3'] }] }],
            },
        };
        original.recommendationAudit.plannedDose = { volume: 1, intensity: 1.1 };
        original.recommendationAudit.executionDose = { volume: 1, intensity: 1.1 };
        original.recommendationAudit.candidateScores = [{
            templateId: 'easy_01', utilityScore: 1, excludedReasons: [], benefitScore: 1, costPenalty: 0,
        }];
        original.recommendationAudit.droppedContributorObjectives = [];

        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), original);
        });

        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const answeredAdherence = {
            respondedAt: '2026-08-08T07:00:00Z',
            followed: true,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        };
        await expect(assertSucceeds(setDoc(
            doc(ownerDb, recommendationPath),
            { adherence: answeredAdherence },
            { merge: true },
        ))).resolves.toBeUndefined();

        const stored = await getDoc(doc(ownerDb, recommendationPath));
        expect(stored.data()?.adherence).toEqual(answeredAdherence);
        expect(stored.data()?.revision).toBe(1);
    });

    it('rejects a cross-user adherence-only merge', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, recommendationPath), {
            adherence: {
                respondedAt: '2026-08-08T07:00:00Z',
                followed: true,
                actualModality: null,
                actualDurationMin: null,
                skipped: false,
                notes: null,
            },
        }, { merge: true }));
    });

    it('allows an owner to create and read a valid fixed activity', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), validFixedActivity()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, fixedActivityPath)))).resolves.toBeDefined();
    });

    it('rejects unauthenticated fixed activity access', async () => {
        const anonDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(setDoc(doc(anonDb, fixedActivityPath), validFixedActivity()));
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        await assertFails(getDoc(doc(anonDb, fixedActivityPath)));
    });

    it('rejects cross-user fixed activity reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, fixedActivityPath)));
        await assertFails(setDoc(doc(otherDb, fixedActivityPath), validFixedActivity()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/fixed_activities/activity-2`), { ...validFixedActivity(), userId: ownerId }));
    });

    it('rejects a fixed activity with an out-of-range durationMin', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), durationMin: 0 }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), durationMin: 1500 }));
    });

    it('rejects a fixed activity with an expectedCost value above 1', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), expectedCost: { systemic: 1.5 } }));
    });

    it('rejects a fixed activity with an unknown environment', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), environment: 'space' }));
    });

    it('rejects a fixed activity with an oversized equipment list', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`) }));
    });

    it('allows a fixed activity with a valid availabilityContextOverride (Phase 6.2b / D6-B)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', equipment: ['indoor_bike'] },
        }))).resolves.toBeUndefined();
    });

    it('rejects a fixed activity with an unknown environment inside availabilityContextOverride', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'space' },
        }));
    });

    it('rejects a fixed activity with an unrecognized key inside availabilityContextOverride', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', extra: true },
        }));
    });

    it('rejects a fixed activity with a malformed date', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), date: '08/12/2026' }));
    });

    it('rejects a fixed activity with a YYYY-MM-DD-shaped but calendar-impossible date', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), date: '2026-02-30' }));
    });

    it('rejects a fixed activity missing the required fixed field', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withoutFixed: Record<string, unknown> = validFixedActivity();
        delete withoutFixed.fixed;
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), withoutFixed));
    });

    it('rejects updating a fixed activity that forges a different owner or createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), userId: otherUserId }, { merge: true }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
    });

    it('allows an owner to update and delete their own fixed activity', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), isCompleted: true }, { merge: true }))).resolves.toBeUndefined();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, fixedActivityPath)))).resolves.toBeUndefined();
    });

    it('allows an owner to create a valid authored travel plan block and rejects malformed ranges or doses', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, planBlockPath), validPlanBlock()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-inverted`), { ...validPlanBlock(), endDate: '2026-08-18' }));
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-impossible`), { ...validPlanBlock(), startDate: '2026-02-30' }));
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-dose`), { ...validPlanBlock(), intensityScale: 1.1 }));
    });

    it('rejects cross-user authored plan block access and forged ownership', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), planBlockPath), validPlanBlock());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, planBlockPath)));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/plan_blocks/forged`), validPlanBlock()));
    });

    it('stores an external plan header, revision and placement for its owner', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), validExternalPlanHeader()));
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), validExternalPlanRevision()));
        await assertSucceeds(setDoc(doc(ownerDb, externalPlacementPath), validExternalPlacement()));
    });

    it('stores a v2 external plan revision (M3.6) -- rules bound sessions but never deep-validate them either version', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            schema: 'adaptive-training-recommender/external-plan@2',
            sessions: [{ id: 'w1-a', title: 'Threshold', priority: 'key', definition: { schemaVersion: 1, title: 'Threshold', intent: 'training', blocks: [] } }],
        }));
    });

    it('makes a stored revision create-only, so an audited decision stays verifiable', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevision(), title: 'edited' }));
        await assertFails(deleteDoc(doc(ownerDb, externalRevisionPath)));
        await assertSucceeds(getDoc(doc(ownerDb, externalRevisionPath)));
    });

    it('refuses an external plan header that moves backwards to a superseded revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalPlanPath), { ...validExternalPlanHeader(), revision: 3 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), revision: 2 }));
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), revision: 4 }));
    });

    it('rejects a malformed external plan header and an over-large revision', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), contentHash: 'short' }));
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), weekCount: 27 }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            schema: 'adaptive-training-recommender/external-plan@3',
        }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevision(), sessions: [] }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/autumn-block/revisions/4`), {
            ...validExternalPlanRevision(),
            revision: 3,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/other-block/revisions/3`), {
            ...validExternalPlanRevision(),
            planId: 'autumn-block',
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/autumn-block/placement/stale`), validExternalPlacement()));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/other-block/placement/current`), validExternalPlacement()));
    });

    it('rejects cross-user external plan access and forged ownership', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalPlanPath), validExternalPlanHeader());
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, externalPlanPath)));
        await assertFails(getDoc(doc(otherDb, externalRevisionPath)));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/external_plans/forged`), validExternalPlanHeader()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/external_plans/autumn-block/placement/current`), validExternalPlacement()));
    });

    it('allows canonical unavailable modalities and rejects unsupported values', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, preferencesPath), validPreferences()));
        await assertFails(setDoc(doc(ownerDb, preferencesPath), {
            ...validPreferences(), unavailableModalities: ['None'],
        }));
    });

    it('enforces ownership, integer capacity, exact shape and immutable creation time for training intent profiles', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const valid = validTrainingIntentProfile();
        await expect(assertSucceeds(setDoc(doc(ownerDb, trainingIntentProfilePath), valid))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-fractional`), {
            ...valid, weeklyCommitment: { ...valid.weeklyCommitment, targetSessions: 2.5 },
        }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-range`), {
            ...valid, weeklyCommitment: { minSessions: 4, targetSessions: 3, maxSessions: 4 },
        }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-mode`), { ...valid, planningMode: 'unsupported' }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-org`), { ...valid, organizationPreference: 'manual' }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-extra-field`), { ...valid, surprise: true }));
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), { ...valid, createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, trainingIntentProfilePath)));
    });

    it('rejects re-saving the same decision with a different audit than what is stored', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation('2026-08-07T08:00:00Z'), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(
            setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation('2026-08-07T09:30:00Z'), revision: 1 }, { merge: true }),
        );
    });

    // --- Decision journal (Phase 9.0.2) ---

    it('allows an owner to create a well-formed decision journal entry', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), validDecisionJournalEntry()))).resolves.toBeUndefined();
    });

    it('rejects a malformed or foreign-owned decision journal entry', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-bad-verdict`), {
            ...validDecisionJournalEntry(), externalVerdict: 'maybe',
        }));
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-extra-field`), {
            ...validDecisionJournalEntry(), surprise: true,
        }));
        const withoutSawFirst: Record<string, unknown> = validDecisionJournalEntry();
        delete withoutSawFirst.sawEngineVerdictFirst;
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-missing-field`), withoutSawFirst));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), date: '2026-08-08' }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), userId: otherUserId }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(
            doc(otherDb, `users/${otherUserId}/decision_journal/2026-08-07`),
            { ...validDecisionJournalEntry(), userId: ownerId },
        ));
    });

    it('rejects cross-user decision journal reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, decisionJournalPath)));
        await assertFails(setDoc(doc(otherDb, decisionJournalPath), validDecisionJournalEntry(), { merge: true }));
    });

    it('allows the evening outcome update but rejects rewriting any morning observation field', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        await expect(assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), actualVerdict: 'scale', updatedAt: '2026-08-07T20:00:00Z',
        }))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), sawEngineVerdictFirst: true,
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), externalVerdict: 'scale',
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), externalNote: 'rewritten after reveal',
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), createdAt: '2099-01-01T00:00:00Z',
        }));
    });

    it('rejects deletion of decision journal evidence, including by its owner', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(deleteDoc(doc(ownerDb, decisionJournalPath)));
    });

    // --- Strength session logging (ADR-0021, S1.3) ---

    const strengthSessionPath = `users/${ownerId}/strength_sessions/session-1`;

    it('allows an owner to create a well-formed strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), validStrengthSession()))).resolves.toBeUndefined();
    });

    it('allows appending sets and advancing state on update, but not rewriting when the session started or which day it belongs to', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), {
            ...validStrengthSession(),
            state: 'completed',
            completedAt: '2026-08-17T18:45:00Z',
            updatedAt: '2026-08-17T18:45:00Z',
            exercises: [
                ...validStrengthSession().exercises,
                { exerciseId: 'front_squat', sets: [{ setIndex: 1, reps: 5, weightKg: 100, isWarmup: false, completedAt: '2026-08-17T18:20:00Z' }] },
            ],
        }))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), date: '2026-08-18' }));
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), startedAt: '2026-08-17T19:00:00Z' }));
    });

    it('rejects a malformed or foreign-owned strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-starts-completed`), {
            ...validStrengthSession(), state: 'completed', completedAt: '2026-08-17T18:45:00Z',
        }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-premature-completion`), {
            ...validStrengthSession(), completedAt: '2026-08-17T18:45:00Z',
        }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-bad-state`), { ...validStrengthSession(), state: 'paused' }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-bad-date`), { ...validStrengthSession(), date: '2026-02-30' }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-bad-schema`), { ...validStrengthSession(), schemaVersion: 2 }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-extra-field`), { ...validStrengthSession(), surprise: true }));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-id-mismatch`), { ...validStrengthSession(), sessionId: 'someone-elses-id' }));
        const withoutExercises: Record<string, unknown> = validStrengthSession();
        delete withoutExercises.exercises;
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-missing-field`), withoutExercises));
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-oversized`), {
            ...validStrengthSession(), exercises: Array.from({ length: 31 }, () => ({ exerciseId: 'front_squat', sets: [] })),
        }));
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), userId: otherUserId }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(
            doc(otherDb, `users/${otherUserId}/strength_sessions/session-1`),
            { ...validStrengthSession(), userId: ownerId },
        ));
    });

    it('makes completed and abandoned strength sessions terminal and immutable', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const completed = {
            ...validStrengthSession(),
            state: 'completed',
            completedAt: '2026-08-17T18:45:00Z',
            updatedAt: '2026-08-17T18:45:00Z',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), completed))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), {
            ...validStrengthSession(), updatedAt: '2026-08-17T19:00:00Z',
        }));
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), {
            ...completed,
            exercises: [...completed.exercises, { exerciseId: 'bench_press', sets: [] }],
        }));
    });

    it('rejects cross-user strength session reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, strengthSessionPath)));
        await assertFails(setDoc(doc(otherDb, strengthSessionPath), validStrengthSession(), { merge: true }));
    });

    it('allows an owner to delete a mis-started strength session', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, strengthSessionPath)))).resolves.toBeUndefined();
    });

    it('M1.6 offline acceptance: persists a logged set, survives simulated reload, and maintains sync', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const initialSession = {
            ...validStrengthSession(),
            exercises: [{ exerciseId: 'bench_press', sets: [] }],
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), initialSession))).resolves.toBeUndefined();

        const withSet = {
            ...initialSession,
            exercises: [{
                exerciseId: 'bench_press',
                sets: [{
                    setIndex: 1,
                    reps: 5,
                    weightKg: 80,
                    isWarmup: false,
                    completedAt: '2026-08-17T18:05:00Z',
                }],
            }],
            updatedAt: '2026-08-17T18:05:00Z',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), withSet))).resolves.toBeUndefined();

        const reloadedSnap = await getDoc(doc(ownerDb, strengthSessionPath));
        expect(reloadedSnap.exists()).toBe(true);
        const data = reloadedSnap.data();
        expect(data?.exercises).toHaveLength(1);
        expect(data?.exercises[0].sets).toHaveLength(1);
        expect(data?.exercises[0].sets[0]).toMatchObject({
            setIndex: 1,
            reps: 5,
            weightKg: 80,
            isWarmup: false,
        });
    });

    // --- Garmin workout queue ---

    const garminQueuePath = `users/${ownerId}/garmin_workout_queue/2026-08-17`;

    function validGarminQueuedWorkout() {
        return {
            userId: ownerId,
            date: '2026-08-17',
            workoutTitle: 'Threshold 3x12',
            modality: 'cycling',
            status: 'pending',
            queuedAt: '2026-08-17T08:00:00Z',
            syncedAt: null,
            error: null,
            payload: {
                schemaVersion: 'canonical_workout_v1',
                title: 'Threshold 3x12',
                workoutId: 's1',
                modality: 'cycling',
                targetDurationMin: 75,
                blocks: [],
                exportedAt: '2026-08-17T08:00:00Z',
            },
        };
    }

    it('allows an owner to queue and read a valid garmin workout item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), validGarminQueuedWorkout()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, garminQueuePath)))).resolves.toBeDefined();
    });

    it('allows an owner to update and re-queue an existing garmin workout item with new queuedAt', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), validGarminQueuedWorkout()))).resolves.toBeUndefined();
        const updated = {
            ...validGarminQueuedWorkout(),
            queuedAt: '2026-08-17T09:30:00Z',
            workoutTitle: 'Threshold 4x10',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), updated))).resolves.toBeUndefined();
    });

    it('rejects a malformed or foreign-owned garmin workout queue item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${garminQueuePath}-bad-status`), {
            ...validGarminQueuedWorkout(), status: 'unknown',
        }));
        await assertFails(setDoc(doc(ownerDb, `${garminQueuePath}-extra-field`), {
            ...validGarminQueuedWorkout(), unexpectedField: true,
        }));
        await assertFails(setDoc(doc(ownerDb, garminQueuePath), {
            ...validGarminQueuedWorkout(), userId: otherUserId,
        }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, garminQueuePath)));
        await assertFails(setDoc(doc(otherDb, garminQueuePath), validGarminQueuedWorkout()));
    });

    it('allows an owner to delete a queued workout item', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), garminQueuePath), validGarminQueuedWorkout());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, garminQueuePath)))).resolves.toBeUndefined();
    });

    // --- Garmin manual "Sync Now" request ---

    const garminSyncRequestPath = `users/${ownerId}/garmin_sync_requests/latest`;

    function validGarminSyncRequest() {
        return {
            userId: ownerId,
            status: 'pending',
            requestedAt: '2026-08-21T06:15:00Z',
            completedAt: null,
            error: null,
        };
    }

    it('allows an owner to create and re-request a manual sync', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminSyncRequestPath), validGarminSyncRequest()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, garminSyncRequestPath)))).resolves.toBeDefined();

        const requeued = { ...validGarminSyncRequest(), requestedAt: '2026-08-21T06:20:00Z' };
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminSyncRequestPath), requeued))).resolves.toBeUndefined();
    });

    it('rejects a malformed, foreign-owned, or non-latest garmin sync request', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'unknown',
        }));
        // The browser may only ever queue 'pending' -- 'processing'/'completed'/'failed'
        // and a non-null error are Admin-SDK-only outcomes the poller reports.
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'processing',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'completed',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), error: 'not a real failure',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), unexpectedField: true,
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), userId: otherUserId,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/garmin_sync_requests/2026-08-21`), validGarminSyncRequest()));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, garminSyncRequestPath)));
        await assertFails(setDoc(doc(otherDb, garminSyncRequestPath), validGarminSyncRequest()));
    });

    it('allows an owner to delete a manual sync request', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), garminSyncRequestPath), validGarminSyncRequest());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, garminSyncRequestPath)))).resolves.toBeUndefined();
    });

    // --- Multidomain session definitions, occurrences, executions & entries (M2.2, M2.3 / ADR-0023) ---

    const sessionDefHeaderPath = `users/${ownerId}/session_definitions/def-full-body`;
    const sessionDefRevPath = `${sessionDefHeaderPath}/revisions/1`;
    const sessionOccPath = `users/${ownerId}/session_occurrences/occ-unplanned-1`;
    const sessionExecPath = `users/${ownerId}/session_executions/exec-1`;
    const sessionEntryPath = `${sessionExecPath}/entries/entry-1`;

    function validSessionDefHeader() {
        return {
            userId: ownerId,
            definitionId: 'def-full-body',
            title: 'Full Body Maintenance',
            latestRevision: 1,
            dominantModality: 'strength',
            createdAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionDefRevision() {
        return {
            userId: ownerId,
            definitionId: 'def-full-body',
            id: 'def-full-body',
            revision: 1,
            schemaVersion: 1,
            title: 'Full Body Maintenance',
            intent: 'training',
            contentHash: 'hash-abc-123',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [
                        {
                            id: 's1',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
                        },
                    ],
                },
            ],
            createdAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionOccurrence() {
        return {
            userId: ownerId,
            occurrenceId: 'occ-unplanned-1',
            date: '2026-08-18',
            authority: 'unplanned_log',
            state: 'active',
            definitionRef: {
                definitionId: 'def-full-body',
                revision: 1,
                contentHash: 'hash-abc-123',
            },
            createdAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionExecution() {
        return {
            userId: ownerId,
            executionId: 'exec-1',
            sessionSource: { kind: 'manual', definitionId: 'def-full-body', revision: 1, contentHash: 'hash-abc-123' },
            date: '2026-08-18',
            startedAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
            state: 'in_progress',
            schemaVersion: 1,
        };
    }

    function validSessionEntry() {
        return {
            id: 'entry-1',
            executionId: 'exec-1',
            completedAt: '2026-08-18T10:05:00Z',
            createdAt: '2026-08-18T10:05:00Z',
            updatedAt: '2026-08-18T10:05:00Z',
            payload: {
                kind: 'repetition',
                setIndex: 1,
                reps: 8,
                weightKg: 60,
                isWarmup: false,
            },
        };
    }

    // --- M5.1: SessionResponse (occurrence-linked response generalization) ---

    const sessionResponsePath = `users/${ownerId}/session_responses/resp-1`;

    function validSessionResponse() {
        return {
            userId: ownerId,
            responseId: 'resp-1',
            sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            window: 'immediate',
            date: '2026-08-18',
            checkinRef: { date: '2026-08-18' },
            sessionRpe: 7,
            createdAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        };
    }

    it('allows an owner to manage session definition header and write-once revision', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefHeaderPath), validSessionDefHeader()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefRevPath), validSessionDefRevision()))).resolves.toBeUndefined();

        // Revision is write-once
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), {
            ...validSessionDefRevision(),
            title: 'Mutated title',
        }));

        // Cross-user is rejected
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, sessionDefHeaderPath)));
        await assertFails(getDoc(doc(otherDb, sessionDefRevPath)));
    });

    const executionPrescriptionPath = `users/${ownerId}/execution_prescriptions/presc-hash-abc`;

    function validExecutionPrescription() {
        return {
            userId: ownerId,
            schemaVersion: 1,
            prescriptionHash: 'presc-hash-abc',
            sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
            definitionHash: 'def-hash-123',
            blocks: [
                {
                    id: 'b1',
                    title: 'Main',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [{ id: 's1', kind: 'exercise' }],
                },
            ],
            createdAt: '2026-08-18T10:00:00Z',
        };
    }

    it('allows owner to write-once execution prescriptions and rejects mutations', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, executionPrescriptionPath), validExecutionPrescription()))).resolves.toBeUndefined();

        // Write-once immutable
        await assertFails(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            definitionHash: 'mutated-hash',
        }));

        // Cross-user denied
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, executionPrescriptionPath)));
    });

    it('allows a catalog execution prescription with a valid displayMetadata snapshot (M3.2)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            displayMetadata: {
                title: 'Full Body Maintenance', intent: 'training', dominantModality: 'Strength', duration: { min: 30, max: 60 },
            },
        }))).resolves.toBeUndefined();
    });

    it('rejects an execution prescription with a malformed displayMetadata snapshot', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            displayMetadata: { intent: 'training' }, // missing required title
        }));
    });

    it('allows valid occurrence authorities in M3 (unplanned_log, schedule, replace, additional) and rejects invalid ones', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // unplanned_log succeeds
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();

        // schedule succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-sched`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-sched',
            authority: 'schedule',
        }))).resolves.toBeUndefined();

        // replace_recommendation succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-replace`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-replace',
            authority: 'replace_recommendation',
        }))).resolves.toBeUndefined();

        // additional_session succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-add`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-add',
            authority: 'additional_session',
        }))).resolves.toBeUndefined();

        // unknown authority is rejected
        await assertFails(setDoc(doc(ownerDb, `${sessionOccPath}-unknown`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-unknown',
            authority: 'bogus_authority',
        }));
    });

    it('allows recommendations with primarySession and additionalSessions bindings', async () => {
        const base = validRecommendation();
        const recWithBindings = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
            },
            additionalSessions: [
                {
                    sessionSource: { kind: 'unplanned_fixture', fixtureId: '01-full-body-maintenance' },
                    prescriptionHash: 'presc-hash-xyz',
                },
            ],
            recommendationAudit: {
                ...base.recommendationAudit,
                primarySession: {
                    sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                    prescriptionHash: 'presc-hash-abc',
                },
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recWithBindings))).resolves.toBeUndefined();
    });

    it('allows additionalSessions at the full 4-element bound without exceeding the rule-evaluation budget', async () => {
        // Regression test: a prior attempt at real per-element validation at the schema's
        // historical 16-element bound blew the emulator's ~1000-expression budget. This
        // proves per-element validation at the current 4-element bound actually works,
        // not just the single-element case the test above already covers.
        const binding = (i: number) => ({
            sessionSource: { kind: 'unplanned_fixture', fixtureId: `0${i}-full-body-maintenance` },
            prescriptionHash: `presc-hash-${i}`,
        });
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            additionalSessions: [binding(1), binding(2), binding(3), binding(4)],
        }))).resolves.toBeUndefined();
    });

    it('rejects additionalSessions beyond the 4-element bound', async () => {
        const binding = (i: number) => ({
            sessionSource: { kind: 'unplanned_fixture', fixtureId: `0${i}-full-body-maintenance` },
            prescriptionHash: `presc-hash-${i}`,
        });
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            additionalSessions: [binding(1), binding(2), binding(3), binding(4), binding(5)],
        }));
    });

    it('rejects a top-level additionalSessions entry with a malformed binding', async () => {
        // Prior to hasValidAdditionalSessions, the top-level additionalSessions field had
        // no shape validation at all -- only keys().hasOnly() gated its presence.
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            additionalSessions: [
                { sessionSource: { kind: 'unplanned_fixture', fixtureId: '01-full-body-maintenance' } }, // missing prescriptionHash
            ],
        }));
    });

    it('rejects an additionalSessions binding whose sessionSource names a valid kind but omits that kind\'s required fields', async () => {
        // hasValidAdditionalSessionBinding checked only sessionSource.kind, so a binding
        // like `{ sessionSource: { kind: 'catalog' }, prescriptionHash: 'x' }` -- missing
        // workoutId/catalogVersion entirely -- previously passed. Cover all three
        // non-trivial kinds so the shape gap can't reopen for any one of them.
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const malformedSources = [
            { kind: 'catalog' }, // missing workoutId, catalogVersion
            { kind: 'manual', definitionId: 'manual-1' }, // missing revision, contentHash
            { kind: 'external_plan', planId: 'autumn-block', revision: 1 }, // missing sessionId, contentHash
        ];
        for (const sessionSource of malformedSources) {
            await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
                ...base,
                additionalSessions: [{ sessionSource, prescriptionHash: 'presc-hash-1' }],
            }));
        }
    });

    it('rejects a recommendationAudit.additionalSessions entry that is not a valid binding', async () => {
        // audit.additionalSessions previously only checked list-ness and length -- any
        // non-binding value (including an empty map) was accepted here even though the
        // top-level additionalSessions field was already shape-checked.
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            recommendationAudit: {
                ...base.recommendationAudit,
                additionalSessions: [{ notABinding: true }],
            },
        }));
    });

    it('allows an authored replacement occurrence provenance in a recommendation audit', async () => {
        const base = validRecommendation();
        const primarySession = {
            sessionSource: {
                kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: 'a'.repeat(64),
            },
            occurrenceId: 'occ-authored-1',
            prescriptionHash: 'b'.repeat(64),
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, recommendationPath), {
            ...base,
            primarySession,
            recommendationAudit: {
                ...base.recommendationAudit,
                candidateScores: [],
                primarySession,
                authoredOccurrence: { occurrenceId: 'occ-authored-1', decision: 'scale' },
            },
        }))).resolves.toBeUndefined();
    });

    it('allows execution lifecycle with entry subcollection mutability while in_progress, and terminal immutability', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        // 1. Create in_progress execution
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        // 2. Add entry while in progress
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionEntryPath), validSessionEntry()))).resolves.toBeUndefined();

        // 3. Update entry while in progress
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'repetition', setIndex: 1, reps: 10, weightKg: 65, isWarmup: false },
        }))).resolves.toBeUndefined();

        // 4. Transition execution to completed
        const completedExec = {
            ...validSessionExecution(),
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
            sessionRpe: 7,
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), completedExec))).resolves.toBeUndefined();

        // 5. Terminal execution is immutable
        await assertFails(setDoc(doc(ownerDb, sessionExecPath), {
            ...completedExec,
            notes: 'Mutated after completion',
        }));

        // 6. Entries cannot be added or mutated once parent execution is completed
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-2`), {
            ...validSessionEntry(),
            id: 'entry-2',
        }));
    });

    it('rejects an execution with an incomplete or unknown source reference', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}-bad-source`), {
            ...validSessionExecution(),
            executionId: 'exec-1-bad-source',
            sessionSource: { kind: 'manual', definitionId: 'def-full-body' },
        }));
    });

    it('rejects malformed performed-entry payloads while the execution is in progress', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'repetition', setIndex: 0, reps: 0 },
        }));
    });

    it('records a recorded athlete choice (D-MCHOICE) while in progress, rejects it once terminal or cross-user, and rejects a malformed one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const validChoiceEntry = {
            id: 'entry-choice-1',
            executionId: 'exec-1',
            stepId: 'step-str-1',
            selectedOptionId: 'reduce-squat-load',
            completedAt: '2026-08-18T10:05:00Z',
            createdAt: '2026-08-18T10:05:00Z',
            updatedAt: '2026-08-18T10:05:00Z',
            payload: { kind: 'choice', choiceId: 'choice-squat-warmup', optionId: 'reduce-squat-load', reason: 'Warm-up felt heavy' },
        };

        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        // Recorded while in progress.
        await expect(assertSucceeds(setDoc(
            doc(ownerDb, `${sessionExecPath}/entries/entry-choice-1`),
            validChoiceEntry,
        ))).resolves.toBeUndefined();

        // Malformed: missing optionId.
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-choice-2`), {
            ...validChoiceEntry,
            id: 'entry-choice-2',
            payload: { kind: 'choice', choiceId: 'choice-squat-warmup' },
        }));

        // Another user cannot write into this execution's entries at all.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, `${sessionExecPath}/entries/entry-choice-3`), {
            ...validChoiceEntry,
            id: 'entry-choice-3',
        }));

        // Terminal immutability: no new choice entry once the execution is completed.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), {
            ...validSessionExecution(),
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-choice-4`), {
            ...validChoiceEntry,
            id: 'entry-choice-4',
        }));
    });

    it('allows an owner to record and revise a session response, and rejects a cross-user read/write', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();

        // Edits preserve provenance: only non-tissue facts and updatedAt may change.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            sessionRpe: 8,
            note: 'legs felt heavier than expected',
            updatedAt: '2026-08-18T11:00:00Z',
        }))).resolves.toBeUndefined();

        // Another user can neither read nor write this response.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, sessionResponsePath)));
        await assertFails(setDoc(doc(otherDb, sessionResponsePath), validSessionResponse()));
    });

    it('rejects an edit that changes sourceSession, window, date or createdAt (provenance)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            sourceSession: { kind: 'strength', id: 'strength-1', date: '2026-08-18' },
        }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), window: 'later_day' }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), date: '2026-08-19' }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), createdAt: '2026-08-19T00:00:00Z' }));
    });

    it('rejects a malformed session response: bad window, out-of-range sessionRpe/completedFraction, extra field, foreign userId', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${sessionResponsePath}-bad-window`), {
            ...validSessionResponse(), responseId: 'resp-1-bad-window', window: 'next_week',
        }));
        await assertFails(setDoc(doc(ownerDb, `${sessionResponsePath}-bad-rpe`), {
            ...validSessionResponse(), responseId: 'resp-1-bad-rpe', sessionRpe: 11,
        }));
        await assertFails(setDoc(doc(ownerDb, `${sessionResponsePath}-bad-fraction`), {
            ...validSessionResponse(), responseId: 'resp-1-bad-fraction', completedFraction: 1.5,
        }));
        await assertFails(setDoc(doc(ownerDb, `${sessionResponsePath}-extra`), {
            ...validSessionResponse(), responseId: 'resp-1-extra', unexpectedField: true,
        }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), userId: otherUserId }));
    });

    it('rejects an edit that adds or changes occurrenceId after creation (provenance)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/session_occurrences/occ-unplanned-2`), {
            ...validSessionOccurrence(), occurrenceId: 'occ-unplanned-2',
        }))).resolves.toBeUndefined();

        // Created with no occurrenceId (e.g. a companion/unplanned execution) -- an edit
        // cannot retroactively grant it selection authority by adding one.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(), occurrenceId: 'occ-unplanned-1',
        }));

        // Created with an occurrenceId -- an edit cannot swap it for a different one.
        const withOccurrencePath = `${sessionResponsePath}-with-occ`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, withOccurrencePath), {
            ...validSessionResponse(), responseId: 'resp-1-with-occ', occurrenceId: 'occ-unplanned-1',
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, withOccurrencePath), {
            ...validSessionResponse(), responseId: 'resp-1-with-occ', occurrenceId: 'occ-unplanned-2',
        }));
    });

    it('rejects a response whose occurrenceId does not reference a real occurrence of this user', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // No session_occurrences/occ-unplanned-1 document has been written in this test.
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            occurrenceId: 'occ-unplanned-1',
        }));

        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            occurrenceId: 'occ-unplanned-1',
        }))).resolves.toBeUndefined();
    });
});
